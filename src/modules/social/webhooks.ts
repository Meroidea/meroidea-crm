import 'server-only';

import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';

import {
  socialAccountCredentials,
  socialAccounts,
  socialConversations,
  socialMessages,
} from '@/db/schema';
import { adminDb } from '@/server/db/admin';
import { serverEnv } from '@/server/env';
import { consumeRateLimit } from '@/server/rate-limit';

import { openCredentials, sealCredentials, usableToken, type Credentials } from './credentials';
import { recordConversation, recordMessage } from './ingest';
import { fetchMetaProfile } from './providers/meta';
import { afterResponse, persistAvatar, persistMessageMedia, type MediaAccess } from './media';
import type { MetaMessageEvent, MetaReceiptEvent } from './providers/meta-webhook';
import { fetchTikTokMessages, type TikTokNotification } from './providers/tiktok';
import { ProviderError, type SocialPlatform } from './providers/types';

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
    return { stored: count, media: withMedia };
  });
  if (media.length > 0) {
    await afterResponse(() => persistMessageMedia(adminDb(), media, access));
  }
  return stored;
}
