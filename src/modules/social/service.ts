import 'server-only';

import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import { contacts, socialAccounts, socialConversations, socialMessages } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { scopeFilter } from '@/lib/permissions/scope';
import { contactScope } from '@/modules/contacts/access';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { readCredentials, storeCredentials, usableToken } from './credentials';
import { recordImportedConversation } from './ingest';
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
      await withRls(ctx, async (tx) => {
        for (const conversation of history) {
          await recordImportedConversation(tx, { tenantId: ctx.tenantId, accountId }, conversation);
        }
      });
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

  const prepared = await withRls(ctx, async (tx) => {
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
          eq(socialConversations.id, input.conversationId),
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
      input.body.length > rules.maxChars ||
      (rules.maxBytes && Buffer.byteLength(input.body) > rules.maxBytes)
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
            inArray(socialMessages.status, ['sending', 'sent']),
            gte(socialMessages.sentAt, conversation.lastInboundAt),
          ),
        );
      if ((sent?.n ?? 0) >= 10) {
        throw new AppError(
          'CONFLICT',
          'TikTok allows ten replies until the customer writes again.',
        );
      }
    }
    const credentials = await readCredentials(tx, ctx.tenantId, account.id);
    if (!credentials) {
      throw new AppError(
        'CONFLICT',
        'This account needs to be connected again before you can reply.',
      );
    }
    const [pending] = await tx
      .insert(socialMessages)
      .values({
        tenantId: ctx.tenantId,
        conversationId: conversation.id,
        accountId: account.id,
        direction: 'outbound',
        body: input.body,
        sentAt: now,
        sentByUserId: ctx.userId,
        status: 'sending',
      })
      .returning({ id: socialMessages.id });
    return { conversation, account, platform, window, credentials, pendingId: pending!.id };
  });

  const { conversation, account, platform, window, credentials, pendingId } = prepared;
  const ref: AccountRef = { platform, externalId: account.externalId, username: account.username };
  let externalId: string | null = null;
  let failure: ProviderError | null = null;
  let renewed = null;
  try {
    const usable = await usableToken(platform, credentials, now);
    renewed = usable.renewed;
    externalId =
      platform === 'tiktok'
        ? await sendTikTokMessage(
            ref,
            usable.token,
            conversation.externalId ?? conversation.participantId,
            input.body,
          )
        : await sendMetaMessage(
            ref,
            usable.token,
            conversation.participantId,
            input.body,
            window.humanAgent,
          );
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
        .where(and(eq(socialMessages.tenantId, ctx.tenantId), eq(socialMessages.id, pendingId)));
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
      .set({ externalId, status: 'sent' })
      .where(
        and(
          eq(socialMessages.tenantId, ctx.tenantId),
          eq(socialMessages.id, pendingId),
          isNull(socialMessages.externalId),
        ),
      );
    await tx
      .update(socialConversations)
      .set({
        lastMessageAt: now,
        lastMessagePreview: previewOf({ body: input.body, attachments: [] }),
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
      action: 'create',
      entityType: 'social_message',
      entityId: pendingId,
      context: { conversationId: conversation.id, platform },
    });
  });
  if (failure) {
    throw new AppError(
      'CONFLICT',
      failure.reconnect
        ? 'The account needs to be connected again: its authorisation no longer works.'
        : `Not sent: ${failure.message}`,
    );
  }
  return { messageId: pendingId };
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
