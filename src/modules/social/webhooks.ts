import 'server-only';

import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';

import {
  socialAccountCredentials,
  socialAccounts,
  socialConversations,
  socialMessages,
  socialMessageTemplates,
} from '@/db/schema';
import { adminDb } from '@/server/db/admin';
import { serverEnv } from '@/server/env';
import { consumeRateLimit } from '@/server/rate-limit';

import { openCredentials, sealCredentials, usableToken, type Credentials } from './credentials';
import {
  linkConversationSender,
  recordConversation,
  recordImportedConversation,
  recordMessage,
} from './ingest';
import { fetchMetaProfile } from './providers/meta';
import { afterResponse, persistAvatar, persistMessageMedia, type MediaAccess } from './media';
import type { MetaMessageEvent, MetaReceiptEvent } from './providers/meta-webhook';
import { fetchTikTokMessages, type TikTokNotification } from './providers/tiktok';
import { ProviderError, type SocialPlatform } from './providers/types';
import { whatsappReason } from './providers/whatsapp';
import type { WhatsAppStatusEvent, WhatsAppWebhook } from './providers/whatsapp-webhook';

/*
 * The only social code that uses the privileged connection (ADR-064, rules/security.md): it runs
 * for a webhook whose Meta signature was verified, or for a TikTok notification that only
 * triggers a read through TikTok's API with the account's own token. An event is stored for the
 * one business that has the account live, and only there.
 */

async function readCredentialsAsSystem(
  tenantId: string,
  accountId: string,
): Promise<Credentials | null> {
  const [row] = await adminDb()
    .select()
    .from(socialAccountCredentials)
    .where(eq(socialAccountCredentials.accountId, accountId))
    .limit(1);
  if (!row || row.tenantId !== tenantId) return null;
  return openCredentials(tenantId, accountId, {
    access_token_ciphertext: row.accessTokenCiphertext,
    access_expires_at: row.accessExpiresAt,
    refresh_token_ciphertext: row.refreshTokenCiphertext,
    refresh_expires_at: row.refreshExpiresAt,
  });
}

async function storeRenewedCredentials(
  tenantId: string,
  accountId: string,
  credentials: Credentials,
) {
  const sealed = sealCredentials(tenantId, accountId, credentials);
  await adminDb()
    .update(socialAccountCredentials)
    .set({
      accessTokenCiphertext: sealed.access,
      accessExpiresAt: credentials.accessExpiresAt,
      refreshTokenCiphertext: sealed.refresh,
      refreshExpiresAt: credentials.refreshExpiresAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(socialAccountCredentials.tenantId, tenantId),
        eq(socialAccountCredentials.accountId, accountId),
      ),
    );
}

async function liveAccountFor(platform: SocialPlatform, externalId: string) {
  const [account] = await adminDb()
    .select({
      id: socialAccounts.id,
      tenantId: socialAccounts.tenantId,
      platform: socialAccounts.platform,
      externalId: socialAccounts.externalId,
      username: socialAccounts.username,
    })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.platform, platform),
        eq(socialAccounts.externalId, externalId),
        isNull(socialAccounts.disconnectedAt),
      ),
    )
    .limit(1);
  return account ?? null;
}

async function markNeedsReconnect(accountId: string, error: ProviderError) {
  await adminDb()
    .update(socialAccounts)
    .set({ status: 'needs_reconnect', lastError: error.message, updatedAt: new Date() })
    .where(eq(socialAccounts.id, accountId));
}

type LiveAccount = NonNullable<Awaited<ReturnType<typeof liveAccountFor>>>;

const refOf = (account: LiveAccount) => ({
  platform: account.platform as SocialPlatform,
  externalId: account.externalId,
  username: account.username,
});

/**
 * Stores the messages from a verified Meta webhook. Returns how many were new. The slow parts,
 * the customer's name and picture and copying media into storage, run after Meta has its answer.
 */
export async function ingestMetaEvents(events: MetaMessageEvent[]): Promise<number> {
  let stored = 0;
  const media: string[] = [];
  const named: { account: LiveAccount; conversationId: string; participantId: string }[] = [];
  for (const event of events) {
    const account = await liveAccountFor(event.platform, event.accountExternalId);
    if (!account) continue;
    const scope = { tenantId: account.tenantId, accountId: account.id };
    const { conversationId, created, fresh } = await adminDb().transaction(async (tx) => {
      const conversation = await recordConversation(tx, scope, {
        externalId: null,
        participantId: event.participantId,
        participantName: null,
        participantUsername: null,
      });
      const message = await recordMessage(
        tx,
        { ...scope, conversationId: conversation.id },
        event.message,
        { countUnread: true },
      );
      return { conversationId: conversation.id, created: conversation.created, fresh: message };
    });
    if (fresh) stored += 1;
    if (fresh?.hasMedia) media.push(fresh.id);
    if (created) named.push({ account, conversationId, participantId: event.participantId });
  }
  if (media.length > 0 || named.length > 0) {
    await afterResponse(async () => {
      for (const item of named)
        await nameNewConversation(item.account, item.conversationId, item.participantId);
      // Meta's attachment links are fetched directly; no token is needed.
      if (media.length > 0) await persistMessageMedia(adminDb(), media, null);
    });
  }
  return stored;
}

/** A conversation that began with a webhook gets the customer's name and picture, best effort. */
async function nameNewConversation(
  account: LiveAccount,
  conversationId: string,
  participantId: string,
) {
  try {
    const credentials = await readCredentialsAsSystem(account.tenantId, account.id);
    if (!credentials) return;
    const profile = await fetchMetaProfile(refOf(account), credentials.accessToken, participantId);
    await adminDb()
      .update(socialConversations)
      .set({ participantName: profile.name, participantUsername: profile.username })
      .where(eq(socialConversations.id, conversationId));
    if (profile.pictureUrl) {
      await persistAvatar(
        adminDb(),
        { id: conversationId, tenantId: account.tenantId },
        profile.pictureUrl,
      );
    }
  } catch (error) {
    if (error instanceof ProviderError && error.reconnect)
      await markNeedsReconnect(account.id, error);
    // Otherwise the conversation simply shows without a name or picture.
  }
  // With the name known (or not), the customer can become a lead if the account is set to.
  await adminDb()
    .transaction((tx) =>
      linkConversationSender(tx, {
        tenantId: account.tenantId,
        accountId: account.id,
        conversationId,
      }),
    )
    .catch((error: unknown) => {
      console.error('[social] could not look up the sender', {
        name: error instanceof Error ? error.name : typeof error,
      });
    });
}

/**
 * Delivery and read receipts move the business's replies forward, never back: sent → delivered
 * → read. A watermark covers every reply sent up to it; Instagram names the one message seen,
 * which covers every reply before it.
 */
export async function applyMetaReceipts(receipts: MetaReceiptEvent[]): Promise<number> {
  let updated = 0;
  for (const receipt of receipts) {
    const account = await liveAccountFor(receipt.platform, receipt.accountExternalId);
    if (!account) continue;
    const [conversation] = await adminDb()
      .select({ id: socialConversations.id })
      .from(socialConversations)
      .where(
        and(
          eq(socialConversations.accountId, account.id),
          eq(socialConversations.participantId, receipt.participantId),
        ),
      )
      .limit(1);
    if (!conversation) continue;
    let upTo = receipt.watermark;
    if (!upTo && receipt.kind === 'read' && receipt.mids.length > 0) {
      const [seen] = await adminDb()
        .select({ sentAt: socialMessages.sentAt })
        .from(socialMessages)
        .where(
          and(
            eq(socialMessages.accountId, account.id),
            inArray(socialMessages.externalId, receipt.mids),
          ),
        )
        .limit(1);
      upTo = seen?.sentAt ?? null;
    }
    updated += await markReplies(account.tenantId, conversation.id, receipt.kind, {
      upTo,
      mids: receipt.kind === 'delivered' ? receipt.mids : [],
    });
  }
  return updated;
}

async function markReplies(
  tenantId: string,
  conversationId: string,
  kind: 'delivered' | 'read',
  which: { upTo: Date | null; mids: string[] },
): Promise<number> {
  if (!which.upTo && which.mids.length === 0) return 0;
  const before = kind === 'read' ? ['sent', 'delivered'] : ['sent'];
  const scope =
    which.upTo && which.mids.length > 0
      ? sql`(${lte(socialMessages.sentAt, which.upTo)} or ${inArray(socialMessages.externalId, which.mids)})`
      : which.upTo
        ? lte(socialMessages.sentAt, which.upTo)
        : inArray(socialMessages.externalId, which.mids);
  const rows = await adminDb()
    .update(socialMessages)
    .set(
      kind === 'read'
        ? {
            status: 'read',
            readAt: new Date(),
            deliveredAt: sql`coalesce(${socialMessages.deliveredAt}, now())`,
          }
        : { status: 'delivered', deliveredAt: new Date() },
    )
    .where(
      and(
        eq(socialMessages.tenantId, tenantId),
        eq(socialMessages.conversationId, conversationId),
        eq(socialMessages.direction, 'outbound'),
        inArray(socialMessages.status, before),
        scope,
      ),
    )
    .returning({ id: socialMessages.id });
  return rows.length;
}

const TIKTOK_MESSAGE_EVENTS = new Set(['im_receive_msg', 'im_send_msg']);

/** An unsigned notification may trigger at most this many reads of one conversation a minute. */
const UNVERIFIED_READS_PER_MINUTE = 6;

/**
 * A TikTok notification for one of our app's accounts. For a message, the conversation's
 * latest messages are read from TikTok with the account's token and stored: the notification's
 * own content is never trusted. Unsigned notifications are throttled, so forged ones cannot
 * spend the account's API quota. A read receipt cannot be confirmed through the API, so it is
 * applied only from a signed notification. Notifications for EEA, Swiss or UK users
 * (`im_receive_msg_eu`) cannot be read through the API and are ignored.
 */
export async function ingestTikTokNotification(
  notification: TikTokNotification,
  verified = false,
): Promise<number> {
  if (notification.appId !== serverEnv().TIKTOK_APP_ID || !notification.conversationId) return 0;
  const account = await liveAccountFor('tiktok', notification.businessId);
  if (!account) return 0;
  const conversationId = notification.conversationId;

  if (notification.event === 'im_mark_read_msg') {
    if (!verified || !notification.lastReadAt) return 0;
    const [conversation] = await adminDb()
      .select({ id: socialConversations.id })
      .from(socialConversations)
      .where(
        and(
          eq(socialConversations.accountId, account.id),
          eq(socialConversations.participantId, conversationId),
        ),
      )
      .limit(1);
    if (!conversation) return 0;
    return markReplies(account.tenantId, conversation.id, 'read', {
      upTo: notification.lastReadAt,
      mids: [],
    });
  }
  if (!TIKTOK_MESSAGE_EVENTS.has(notification.event)) return 0;
  if (
    !verified &&
    !(await consumeRateLimit({
      bucket: 'social:tiktok-unverified-read',
      subject: `${account.id}:${conversationId}`,
      limit: UNVERIFIED_READS_PER_MINUTE,
      windowSeconds: 60,
    }))
  ) {
    return 0;
  }
  const credentials = await readCredentialsAsSystem(account.tenantId, account.id);
  if (!credentials) return 0;

  let messages;
  let customerUsername: string | null = null;
  let access: MediaAccess = null;
  try {
    const usable = await usableToken('tiktok', credentials);
    if (usable.renewed) {
      await storeRenewedCredentials(account.tenantId, account.id, usable.renewed);
    }
    access = { account: refOf(account), token: usable.token };
    ({ messages, customerUsername } = await fetchTikTokMessages(
      refOf(account),
      usable.token,
      conversationId,
    ));
  } catch (error) {
    if (error instanceof ProviderError) {
      if (error.reconnect) await markNeedsReconnect(account.id, error);
      // Rate limited or unavailable: the next notification reads the conversation again.
      return 0;
    }
    throw error;
  }

  const scope = { tenantId: account.tenantId, accountId: account.id };
  const { stored, media } = await adminDb().transaction(async (tx) => {
    const conversation = await recordConversation(tx, scope, {
      externalId: conversationId,
      participantId: conversationId,
      participantName: null,
      participantUsername: customerUsername,
    });
    let count = 0;
    const withMedia: string[] = [];
    const ordered = [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    for (const message of ordered) {
      const fresh = await recordMessage(
        tx,
        { ...scope, conversationId: conversation.id },
        message,
        {
          countUnread: true,
        },
      );
      if (!fresh) continue;
      count += 1;
      if (fresh.hasMedia) withMedia.push(fresh.id);
    }
    if (ordered.some((message) => message.direction === 'inbound') && count > 0) {
      await linkConversationSender(tx, { ...scope, conversationId: conversation.id });
    }
    return { stored: count, media: withMedia };
  });
  if (media.length > 0) {
    await afterResponse(() => persistMessageMedia(adminDb(), media, access));
  }
  return stored;
}

/*
 * WhatsApp (ADR-066). The webhook names the business's number by id; everything is stored for
 * the one business that has that number live, and only there.
 */

type AccountCache = Map<string, LiveAccount | null>;

async function whatsappAccount(cache: AccountCache, phoneNumberId: string) {
  if (!cache.has(phoneNumberId)) {
    cache.set(phoneNumberId, await liveAccountFor('whatsapp', phoneNumberId));
  }
  return cache.get(phoneNumberId) ?? null;
}

/**
 * Copies the media of these messages into storage after Meta has its answer. WhatsApp files
 * are reached with the account's own token, read here for the purpose.
 */
async function persistWhatsAppMedia(media: Map<LiveAccount, string[]>) {
  if (media.size === 0) return;
  await afterResponse(async () => {
    for (const [account, ids] of media) {
      const credentials = await readCredentialsAsSystem(account.tenantId, account.id);
      if (!credentials) continue;
      await persistMessageMedia(adminDb(), ids, {
        account: refOf(account),
        token: credentials.accessToken,
      });
    }
  });
}

/** Stores a verified WhatsApp webhook. Returns how many messages were new. */
export async function ingestWhatsAppWebhook(webhook: WhatsAppWebhook): Promise<number> {
  const cache: AccountCache = new Map();
  const media = new Map<LiveAccount, string[]>();
  const withMedia = (account: LiveAccount, id: string) =>
    media.set(account, [...(media.get(account) ?? []), id]);
  let stored = 0;

  for (const event of webhook.messages) {
    const account = await whatsappAccount(cache, event.phoneNumberId);
    if (!account) continue;
    const scope = { tenantId: account.tenantId, accountId: account.id };
    const fresh = await adminDb().transaction(async (tx) => {
      const conversation = await recordConversation(tx, scope, {
        externalId: null,
        participantId: event.participantId,
        participantName: event.participantName,
        participantUsername: null,
        participantPhone: event.participantPhone,
      });
      const message = await recordMessage(
        tx,
        { ...scope, conversationId: conversation.id },
        event.message,
        { countUnread: event.message.direction === 'inbound' },
      );
      if (message && event.message.direction === 'inbound') {
        await linkConversationSender(tx, { ...scope, conversationId: conversation.id });
      }
      return message;
    });
    if (fresh) stored += 1;
    if (fresh?.hasMedia) withMedia(account, fresh.id);
  }

  for (const change of webhook.changes) {
    const account = await whatsappAccount(cache, change.phoneNumberId);
    if (!account) continue;
    await adminDb()
      .update(socialMessages)
      .set(
        change.kind === 'revoke'
          ? { body: 'This message was deleted.', attachments: [] }
          : { body: change.body },
      )
      .where(
        and(
          eq(socialMessages.tenantId, account.tenantId),
          eq(socialMessages.accountId, account.id),
          eq(socialMessages.externalId, change.originalId),
        ),
      );
  }

  await applyWhatsAppStatuses(cache, webhook.statuses);

  for (const chunk of webhook.history) {
    const account = await whatsappAccount(cache, chunk.phoneNumberId);
    if (!account) continue;
    const scope = { tenantId: account.tenantId, accountId: account.id };
    for (const thread of chunk.threads) {
      // History is older than the connection, so it neither counts as unread nor opens
      // WhatsApp's 24 hours for a free-form reply.
      const result = await adminDb().transaction((tx) =>
        recordImportedConversation(
          tx,
          scope,
          {
            externalId: null,
            participantId: thread.participantId,
            participantName: null,
            participantUsername: null,
            participantPhone: thread.participantPhone,
            messages: thread.messages,
          },
          { opensWindow: false },
        ),
      );
      stored += result.stored;
      for (const id of result.withMedia) withMedia(account, id);
    }
    await adminDb()
      .update(socialAccounts)
      .set(
        chunk.declined
          ? { historySync: 'declined', updatedAt: new Date() }
          : {
              historySync:
                chunk.progress === 100
                  ? 'complete'
                  : sql`case when ${socialAccounts.historySync} = 'complete' then 'complete' else 'in_progress' end`,
              historyProgress: sql`greatest(coalesce(${socialAccounts.historyProgress}, 0), ${chunk.progress ?? 0})`,
              updatedAt: new Date(),
            },
      )
      .where(eq(socialAccounts.id, account.id));
  }

  for (const event of webhook.contacts) {
    const account = await whatsappAccount(cache, event.phoneNumberId);
    if (!account) continue;
    // The business's own names for customers it already has conversations with.
    for (const contact of event.contacts.slice(0, 5000)) {
      await adminDb()
        .update(socialConversations)
        .set({ participantName: contact.name, updatedAt: new Date() })
        .where(
          and(
            eq(socialConversations.tenantId, account.tenantId),
            eq(socialConversations.accountId, account.id),
            eq(socialConversations.participantPhone, contact.phone),
            isNull(socialConversations.participantName),
          ),
        );
    }
  }

  for (const update of webhook.templates) {
    // The template belongs to the WhatsApp Business Account of one or more live numbers.
    await adminDb()
      .update(socialMessageTemplates)
      .set({ status: update.status, reason: update.reason, updatedAt: new Date() })
      .where(
        and(
          eq(socialMessageTemplates.externalId, update.templateId),
          inArray(
            socialMessageTemplates.accountId,
            adminDb()
              .select({ id: socialAccounts.id })
              .from(socialAccounts)
              .where(
                and(
                  eq(socialAccounts.platform, 'whatsapp'),
                  eq(socialAccounts.providerBusinessId, update.wabaId),
                  isNull(socialAccounts.disconnectedAt),
                ),
              ),
          ),
        ),
      );
  }

  await persistWhatsAppMedia(media);
  return stored;
}

/**
 * Moves the business's WhatsApp messages forward as WhatsApp reports them: delivered, read, or
 * failed with the reason in words the business can act on (a closed reply window, billing).
 * Never backwards: a late "delivered" does not undo "read".
 */
async function applyWhatsAppStatuses(cache: AccountCache, statuses: WhatsAppStatusEvent[]) {
  for (const status of statuses) {
    if (status.status === 'sent') continue;
    const account = await whatsappAccount(cache, status.phoneNumberId);
    if (!account) continue;
    const before =
      status.status === 'delivered'
        ? ['sent']
        : status.status === 'read'
          ? ['sent', 'delivered']
          : ['sending', 'sent', 'delivered'];
    const set =
      status.status === 'delivered'
        ? { status: 'delivered', deliveredAt: status.at }
        : status.status === 'read'
          ? {
              status: 'read',
              readAt: status.at,
              deliveredAt: sql`coalesce(${socialMessages.deliveredAt}, ${status.at.toISOString()}::timestamptz)`,
            }
          : {
              status: 'failed',
              error:
                whatsappReason(status.errorCode) ??
                status.errorTitle ??
                'WhatsApp could not deliver this message.',
            };
    await adminDb()
      .update(socialMessages)
      .set(set)
      .where(
        and(
          eq(socialMessages.tenantId, account.tenantId),
          eq(socialMessages.accountId, account.id),
          eq(socialMessages.externalId, status.messageId),
          eq(socialMessages.direction, 'outbound'),
          inArray(socialMessages.status, before),
        ),
      );
  }
}
