import 'server-only';

import { and, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';

import { contacts, socialAccounts, socialConversations, socialMessages } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { scopeFilter } from '@/lib/permissions/scope';
import { contactScope } from '@/modules/contacts/access';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import { readCredentials, storeCredentials, usableToken, type Credentials } from './credentials';
import { recordImportedConversation } from './ingest';
import { afterResponse, persistMessageMedia, type MediaAccess } from './media';
import type { OAuthProvider } from './oauth-state-keys';
import {
  discoverMetaAccounts,
  exchangeMetaCode,
  fetchMetaConversations,
  sendMetaMessage,
  subscribeMetaAccount,
  unsubscribeMetaAccount,
} from './providers/meta';
import {
  exchangeTikTokCode,
  fetchTikTokConversations,
  sendTikTokMessage,
} from './providers/tiktok';
import {
  previewOf,
  ProviderError,
  type AccountRef,
  type DiscoveredAccount,
  type SocialPlatform,
} from './providers/types';
import type { ReplyInput } from './schemas';

const HOUR = 3_600_000;

/** How long after the customer's last message each platform lets a business reply. */
export const REPLY_RULES: Record<
  SocialPlatform,
  { normalHours: number; humanAgentHours: number | null; maxChars: number; maxBytes?: number }
> = {
  facebook: { normalHours: 24, humanAgentHours: 7 * 24, maxChars: 2000 },
  instagram: { normalHours: 24, humanAgentHours: 7 * 24, maxChars: 1000, maxBytes: 1000 },
  tiktok: { normalHours: 48, humanAgentHours: null, maxChars: 6000 },
};

/** Whether a reply may go now, and whether it needs the human agent tag; or why not. */
export function replyWindow(
  platform: SocialPlatform,
  lastInboundAt: Date | null,
  now = new Date(),
): { ok: true; humanAgent: boolean } | { ok: false; reason: string } {
  if (!lastInboundAt) {
    return { ok: false, reason: 'You can reply once the customer has written to you.' };
  }
  const rules = REPLY_RULES[platform];
  const age = now.getTime() - lastInboundAt.getTime();
  if (age <= rules.normalHours * HOUR) return { ok: true, humanAgent: false };
  if (rules.humanAgentHours !== null && age <= rules.humanAgentHours * HOUR) {
    return { ok: true, humanAgent: true };
  }
  const limit = rules.humanAgentHours ?? rules.normalHours;
  return {
    ok: false,
    reason: `The customer last wrote more than ${limit >= 48 ? `${limit / 24} days` : `${limit} hours`} ago. ${
      platform === 'tiktok' ? 'TikTok' : platform === 'facebook' ? 'Messenger' : 'Instagram'
    } only allows a reply after they write again.`,
  };
}

const describe = (error: unknown) =>
  error instanceof ProviderError ? error.message : 'Something went wrong on our side.';

async function discover(
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
): Promise<DiscoveredAccount[]> {
  if (provider === 'meta') return discoverMetaAccounts(await exchangeMetaCode(code, redirectUri));
  return [await exchangeTikTokCode(code, redirectUri)];
}

async function fetchHistory(account: AccountRef, token: string) {
  return account.platform === 'tiktok'
    ? fetchTikTokConversations(account, token)
    : fetchMetaConversations(account, token);
}

/**
 * Finishes connecting after the business logged in with Meta or TikTok: every account it shared
 * is saved with its sealed token, subscribed to our webhook and its recent conversations
 * imported. An account already live in another business is left alone (one business per
 * account, so a message has one place to go); the business is told only that it was skipped.
 */
export async function connectAccounts(
  ctx: TenantContext,
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
): Promise<{ connected: number; skipped: number; failed: number }> {
  requirePermission(ctx, 'social.manage');
  const discovered = await discover(provider, code, redirectUri);
  let connected = 0;
  let skipped = 0;
  let failed = 0;

  for (const found of discovered) {
    let accountId: string;
    try {
      accountId = await withRls(ctx, async (tx) => {
        // Connecting an account again, even after a disconnect, continues its history.
        const [existing] = await tx
          .select({ id: socialAccounts.id })
          .from(socialAccounts)
          .where(
            and(
              eq(socialAccounts.tenantId, ctx.tenantId),
              eq(socialAccounts.platform, found.platform),
              eq(socialAccounts.externalId, found.externalId),
            ),
          )
          .orderBy(desc(socialAccounts.connectedAt))
          .limit(1);
        const details = {
          name: found.name,
          username: found.username,
          avatarUrl: found.avatarUrl,
          providerBusinessId: found.providerBusinessId,
          status: 'active',
          lastError: null,
          disconnectedAt: null,
          updatedAt: new Date(),
        };
        let id = existing?.id;
        if (id) {
          await tx
            .update(socialAccounts)
            .set(details)
            .where(and(eq(socialAccounts.tenantId, ctx.tenantId), eq(socialAccounts.id, id)));
        } else {
          const [row] = await tx
            .insert(socialAccounts)
            .values({
              ...details,
              tenantId: ctx.tenantId,
              platform: found.platform,
              externalId: found.externalId,
              connectedBy: ctx.userId,
            })
            .returning({ id: socialAccounts.id });
          id = row!.id;
        }
        await storeCredentials(tx, ctx.tenantId, id, found);
        await audit(tx, ctx, {
          action: existing ? 'update' : 'create',
          entityType: 'social_account',
          entityId: id,
          context: { platform: found.platform, reconnected: Boolean(existing) },
        });
        return id;
      });
    } catch (error) {
      // The live-account index: this account is connected to another business.
      if ((error as { cause?: { code?: string } }).cause?.code === '23505') {
        skipped += 1;
        continue;
      }
      throw error;
    }

    const ref: AccountRef = {
      platform: found.platform,
      externalId: found.externalId,
      username: found.username,
    };
    let lastError: string | null = null;
    try {
      if (found.platform !== 'tiktok') await subscribeMetaAccount(ref, found.accessToken);
      const history = await fetchHistory(ref, found.accessToken);
      const withMedia = await withRls(ctx, async (tx) => {
        const ids: string[] = [];
        for (const conversation of history) {
          const result = await recordImportedConversation(
            tx,
            { tenantId: ctx.tenantId, accountId },
            conversation,
          );
          ids.push(...result.withMedia);
        }
        return ids;
      });
      if (withMedia.length > 0) {
        // Copying the imported media into storage can take a while: after the person is back
        // on the accounts page, still as them and under RLS.
        const access: MediaAccess =
          found.platform === 'tiktok' ? { account: ref, token: found.accessToken } : null;
        await afterResponse(() => withRls(ctx, (tx) => persistMessageMedia(tx, withMedia, access)));
      }
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      lastError = describe(error);
      failed += 1;
    }
    await withRls(ctx, (tx) =>
      tx
        .update(socialAccounts)
        .set({ lastSyncedAt: new Date(), lastError, updatedAt: new Date() })
        .where(and(eq(socialAccounts.tenantId, ctx.tenantId), eq(socialAccounts.id, accountId))),
    );
    connected += 1;
  }
  return { connected, skipped, failed };
}

async function liveAccount(ctx: TenantContext, accountId: string) {
  return withRls(ctx, async (tx) => {
    const [account] = await tx
      .select()
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.tenantId, ctx.tenantId),
          eq(socialAccounts.id, accountId),
          isNull(socialAccounts.disconnectedAt),
        ),
      )
      .limit(1);
    if (!account) throw new AppError('NOT_FOUND', 'That account is not connected.');
    const credentials = await readCredentials(tx, ctx.tenantId, account.id);
    return { account, credentials };
  });
}

/**
 * Disconnects an account: the provider stops sending its messages, its tokens are forgotten, and
 * the conversations so far stay as the business's record.
 */
export async function disconnectAccount(ctx: TenantContext, accountId: string): Promise<void> {
  requirePermission(ctx, 'social.manage');
  const { account, credentials } = await liveAccount(ctx, accountId);
  if (credentials && account.platform !== 'tiktok') {
    // Best effort: a token that no longer works cannot unsubscribe, and Meta stops on its own.
    await unsubscribeMetaAccount(
      {
        platform: account.platform as SocialPlatform,
        externalId: account.externalId,
        username: null,
      },
      credentials.accessToken,
    ).catch(() => undefined);
  }
  await withRls(ctx, async (tx) => {
    await tx.execute(sql`select app.social_clear_credentials(${account.id}::uuid)`);
    await tx
      .update(socialAccounts)
      .set({ status: 'disconnected', disconnectedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(socialAccounts.tenantId, ctx.tenantId), eq(socialAccounts.id, account.id)));
    await audit(tx, ctx, {
      action: 'delete',
      entityType: 'social_account',
      entityId: account.id,
      context: { platform: account.platform },
    });
  });
}

type Prepared = {
  conversation: typeof socialConversations.$inferSelect;
  account: typeof socialAccounts.$inferSelect;
  platform: SocialPlatform;
  humanAgent: boolean;
  credentials: Credentials;
  messageId: string;
  body: string;
};

/**
 * Everything a reply must pass before it goes: a live account, the platform's length and reply
 * window (and TikTok's ten replies per window), and usable tokens. Runs inside the caller's
 * transaction; `excluding` leaves a retried message out of TikTok's count.
 */
async function checkReply(
  tx: Tx,
  ctx: TenantContext,
  conversationId: string,
  body: string,
  now: Date,
  excluding?: string,
) {
  const [row] = await tx
    .select({ conversation: socialConversations, account: socialAccounts })
    .from(socialConversations)
    .innerJoin(
      socialAccounts,
      and(
        eq(socialAccounts.tenantId, socialConversations.tenantId),
        eq(socialAccounts.id, socialConversations.accountId),
      ),
    )
    .where(
      and(
        eq(socialConversations.tenantId, ctx.tenantId),
        eq(socialConversations.id, conversationId),
      ),
    )
    .limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'That conversation was not found.');
  const { conversation, account } = row;
  const platform = account.platform as SocialPlatform;
  if (account.disconnectedAt) {
    throw new AppError('CONFLICT', 'This account is disconnected. Connect it again to reply.');
  }
  const rules = REPLY_RULES[platform];
  if (
    body.length > rules.maxChars ||
    (rules.maxBytes && Buffer.byteLength(body) > rules.maxBytes)
  ) {
    throw new AppError(
      'VALIDATION',
      `Replies on this platform can be at most ${rules.maxChars} characters.`,
    );
  }
  const window = replyWindow(platform, conversation.lastInboundAt, now);
  if (!window.ok) throw new AppError('CONFLICT', window.reason);
  if (platform === 'tiktok' && conversation.lastInboundAt) {
    // TikTok allows ten messages in the 48 hours after each message from the customer.
    const [sent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(socialMessages)
      .where(
        and(
          eq(socialMessages.tenantId, ctx.tenantId),
          eq(socialMessages.conversationId, conversation.id),
          eq(socialMessages.direction, 'outbound'),
          inArray(socialMessages.status, ['sending', 'sent', 'delivered', 'read']),
          gte(socialMessages.sentAt, conversation.lastInboundAt),
          excluding ? ne(socialMessages.id, excluding) : undefined,
        ),
      );
    if ((sent?.n ?? 0) >= 10) {
      throw new AppError('CONFLICT', 'TikTok allows ten replies until the customer writes again.');
    }
  }
  const credentials = await readCredentials(tx, ctx.tenantId, account.id);
  if (!credentials) {
    throw new AppError(
      'CONFLICT',
      'This account needs to be connected again before you can reply.',
    );
  }
  return { conversation, account, platform, humanAgent: window.humanAgent, credentials };
}

/**
 * Sends a reply from Meroidea. The message is stored as "sending" first, so a webhook echo that
 * arrives before the provider's answer finds it instead of adding a copy; it then becomes sent
 * or failed, with the provider's reason.
 */
export async function replyToConversation(
  ctx: TenantContext,
  input: ReplyInput,
  now = new Date(),
): Promise<{ messageId: string }> {
  requirePermission(ctx, 'social.reply');
  const prepared = await withRls(ctx, async (tx): Promise<Prepared> => {
    const checked = await checkReply(tx, ctx, input.conversationId, input.body, now);
    const [pending] = await tx
      .insert(socialMessages)
      .values({
        tenantId: ctx.tenantId,
        conversationId: checked.conversation.id,
        accountId: checked.account.id,
        direction: 'outbound',
        body: input.body,
        sentAt: now,
        sentByUserId: ctx.userId,
        status: 'sending',
      })
      .returning({ id: socialMessages.id });
    return { ...checked, messageId: pending!.id, body: input.body };
  });
  return deliver(ctx, prepared, now, 'create');
}

/**
 * Sends a failed reply again, as the same message, once the reason has passed: a rate limit
 * lifted, the account reconnected, the customer written again. Every check runs afresh.
 */
export async function retryReply(
  ctx: TenantContext,
  messageId: string,
  now = new Date(),
): Promise<{ messageId: string }> {
  requirePermission(ctx, 'social.reply');
  const prepared = await withRls(ctx, async (tx): Promise<Prepared> => {
    const [failed] = await tx
      .select({
        id: socialMessages.id,
        conversationId: socialMessages.conversationId,
        body: socialMessages.body,
      })
      .from(socialMessages)
      .where(
        and(
          eq(socialMessages.tenantId, ctx.tenantId),
          eq(socialMessages.id, messageId),
          eq(socialMessages.direction, 'outbound'),
          eq(socialMessages.status, 'failed'),
        ),
      )
      .limit(1)
      .for('update');
    if (!failed || !failed.body) throw new AppError('NOT_FOUND', 'That reply was not found.');
    const checked = await checkReply(tx, ctx, failed.conversationId, failed.body, now, failed.id);
    await tx
      .update(socialMessages)
      .set({ status: 'sending', error: null })
      .where(and(eq(socialMessages.tenantId, ctx.tenantId), eq(socialMessages.id, failed.id)));
    return { ...checked, messageId: failed.id, body: failed.body };
  });
  return deliver(ctx, prepared, now, 'update');
}

/** Calls the provider outside any transaction, then records the outcome. */
async function deliver(
  ctx: TenantContext,
  prepared: Prepared,
  now: Date,
  action: 'create' | 'update',
): Promise<{ messageId: string }> {
  const { conversation, account, platform, humanAgent, credentials, messageId, body } = prepared;
  const ref: AccountRef = { platform, externalId: account.externalId, username: account.username };
  let externalId: string | null = null;
  let failure: ProviderError | null = null;
  let renewed: Credentials | null = null;
  try {
    const usable = await usableToken(platform, credentials, now);
    renewed = usable.renewed;
    externalId =
      platform === 'tiktok'
        ? await sendTikTokMessage(
            ref,
            usable.token,
            conversation.externalId ?? conversation.participantId,
            body,
          )
        : await sendMetaMessage(ref, usable.token, conversation.participantId, body, humanAgent);
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    failure = error;
  }

  await withRls(ctx, async (tx) => {
    if (renewed) await storeCredentials(tx, ctx.tenantId, account.id, renewed);
    if (failure) {
      await tx
        .update(socialMessages)
        .set({ status: 'failed', error: failure.message })
        .where(and(eq(socialMessages.tenantId, ctx.tenantId), eq(socialMessages.id, messageId)));
      if (failure.reconnect) {
        await tx
          .update(socialAccounts)
          .set({ status: 'needs_reconnect', lastError: failure.message, updatedAt: new Date() })
          .where(and(eq(socialAccounts.tenantId, ctx.tenantId), eq(socialAccounts.id, account.id)));
      }
      return;
    }
    // A webhook echo may already have claimed the row and set its id.
    await tx
      .update(socialMessages)
      .set({ externalId, status: 'sent', sentAt: now })
      .where(
        and(
          eq(socialMessages.tenantId, ctx.tenantId),
          eq(socialMessages.id, messageId),
          isNull(socialMessages.externalId),
        ),
      );
    await tx
      .update(socialConversations)
      .set({
        lastMessageAt: now,
        lastMessagePreview: previewOf({ body, attachments: [] }),
        unreadCount: 0,
        updatedAt: now,
      })
      .where(
        and(
          eq(socialConversations.tenantId, ctx.tenantId),
          eq(socialConversations.id, conversation.id),
        ),
      );
    await audit(tx, ctx, {
      action,
      entityType: 'social_message',
      entityId: messageId,
      context: { conversationId: conversation.id, platform, retried: action === 'update' },
    });
  });
  if (failure) throw replyFailure(failure);
  return { messageId };
}

/** The reason a reply was not sent, in words the person can act on. */
function replyFailure(failure: ProviderError): AppError {
  if (failure.rateLimited) {
    const wait = failure.retryAfterMinutes;
    return new AppError(
      'RATE_LIMITED',
      `Not sent yet: the platform is limiting messages right now. ${
        wait
          ? `Try again in about ${wait} ${wait === 1 ? 'minute' : 'minutes'}`
          : 'Try again in a few minutes'
      } with Retry.`,
    );
  }
  if (failure.reconnect) {
    return new AppError(
      'CONFLICT',
      'The account needs to be connected again: its authorisation no longer works.',
    );
  }
  return new AppError('CONFLICT', `Not sent: ${failure.message}`);
}

/** Links the customer to a CRM contact the person can see, or unlinks them. */
export async function linkConversationContact(
  ctx: TenantContext,
  input: { conversationId: string; contactId: string | null },
): Promise<void> {
  requirePermission(ctx, 'social.reply');
  if (input.contactId) requirePermission(ctx, 'contacts.view');
  await withRls(ctx, async (tx) => {
    const [conversation] = await tx
      .select({ id: socialConversations.id, contactId: socialConversations.contactId })
      .from(socialConversations)
      .where(
        and(
          eq(socialConversations.tenantId, ctx.tenantId),
          eq(socialConversations.id, input.conversationId),
        ),
      )
      .limit(1);
    if (!conversation) throw new AppError('NOT_FOUND', 'That conversation was not found.');
    if (input.contactId) {
      const [contact] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.tenantId, ctx.tenantId),
            eq(contacts.id, input.contactId),
            isNull(contacts.deletedAt),
            scopeFilter(ctx, 'contacts.view', contacts, contactScope),
          ),
        )
        .limit(1);
      if (!contact) throw new AppError('NOT_FOUND', 'That contact was not found.');
    }
    await tx
      .update(socialConversations)
      .set({ contactId: input.contactId, updatedAt: new Date() })
      .where(
        and(
          eq(socialConversations.tenantId, ctx.tenantId),
          eq(socialConversations.id, conversation.id),
        ),
      );
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'social_conversation',
      entityId: conversation.id,
      changes: { contactId: [conversation.contactId, input.contactId] },
    });
  });
}

/** Marks a conversation done, or open again. */
export async function setConversationStatus(
  ctx: TenantContext,
  input: { conversationId: string; status: 'open' | 'done' },
): Promise<void> {
  requirePermission(ctx, 'social.reply');
  await withRls(ctx, async (tx) => {
    const [row] = await tx
      .update(socialConversations)
      .set({ status: input.status, updatedAt: new Date() })
      .where(
        and(
          eq(socialConversations.tenantId, ctx.tenantId),
          eq(socialConversations.id, input.conversationId),
        ),
      )
      .returning({ id: socialConversations.id });
    if (!row) throw new AppError('NOT_FOUND', 'That conversation was not found.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'social_conversation',
      entityId: row.id,
      changes: { status: [input.status === 'done' ? 'open' : 'done', input.status] },
    });
  });
}

/** Opening a conversation reads it. */
export async function markConversationRead(
  ctx: TenantContext,
  conversationId: string,
): Promise<void> {
  requirePermission(ctx, 'social.view');
  await withRls(ctx, (tx) =>
    tx
      .update(socialConversations)
      .set({ unreadCount: 0 })
      .where(
        and(
          eq(socialConversations.tenantId, ctx.tenantId),
          eq(socialConversations.id, conversationId),
          sql`${socialConversations.unreadCount} > 0`,
        ),
      ),
  );
}
