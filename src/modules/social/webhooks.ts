import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { socialAccountCredentials, socialAccounts, socialConversations } from '@/db/schema';
import { adminDb } from '@/server/db/admin';
import { serverEnv } from '@/server/env';

import { openCredentials, sealCredentials, usableToken, type Credentials } from './credentials';
import { recordConversation, recordMessage } from './ingest';
import { fetchMetaProfile } from './providers/meta';
import type { MetaMessageEvent } from './providers/meta-webhook';
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

/** Stores the messages from a verified Meta webhook. Returns how many were new. */
export async function ingestMetaEvents(events: MetaMessageEvent[]): Promise<number> {
  let stored = 0;
  for (const event of events) {
    const account = await liveAccountFor(event.platform, event.accountExternalId);
    if (!account) continue;
    const scope = { tenantId: account.tenantId, accountId: account.id };
    const { conversationId, created, isNew } = await adminDb().transaction(async (tx) => {
      const conversation = await recordConversation(tx, scope, {
        externalId: null,
        participantId: event.participantId,
        participantName: null,
        participantUsername: null,
      });
      const fresh = await recordMessage(
        tx,
        { ...scope, conversationId: conversation.id },
        event.message,
        { countUnread: true },
      );
      return { conversationId: conversation.id, created: conversation.created, isNew: fresh };
    });
    if (isNew) stored += 1;
    if (created) await nameNewConversation(account, conversationId, event.participantId);
  }
  return stored;
}

/** A conversation that began with a webhook gets the customer's name, best effort. */
async function nameNewConversation(
  account: NonNullable<Awaited<ReturnType<typeof liveAccountFor>>>,
  conversationId: string,
  participantId: string,
) {
  try {
    const credentials = await readCredentialsAsSystem(account.tenantId, account.id);
    if (!credentials) return;
    const profile = await fetchMetaProfile(
      {
        platform: account.platform as SocialPlatform,
        externalId: account.externalId,
        username: null,
      },
      credentials.accessToken,
      participantId,
    );
    await adminDb()
      .update(socialConversations)
      .set({ participantName: profile.name, participantUsername: profile.username })
      .where(eq(socialConversations.id, conversationId));
  } catch (error) {
    if (error instanceof ProviderError && error.reconnect)
      await markNeedsReconnect(account.id, error);
    // Otherwise the conversation simply shows without a name.
  }
}

const TIKTOK_MESSAGE_EVENTS = new Set(['im_receive_msg', 'im_send_msg']);

/**
 * A TikTok notification for one of our apps' accounts: the conversation's latest messages are
 * read from TikTok with the account's token and stored. Notifications for EEA, Swiss or UK users
 * (`im_receive_msg_eu`) cannot be read through the API and are ignored.
 */
export async function ingestTikTokNotification(notification: TikTokNotification): Promise<number> {
  if (notification.appId !== serverEnv().TIKTOK_APP_ID) return 0;
  if (!TIKTOK_MESSAGE_EVENTS.has(notification.event) || !notification.conversationId) return 0;
  const account = await liveAccountFor('tiktok', notification.businessId);
  if (!account) return 0;
  const credentials = await readCredentialsAsSystem(account.tenantId, account.id);
  if (!credentials) return 0;

  let messages;
  let customerUsername: string | null = null;
  try {
    const usable = await usableToken('tiktok', credentials);
    if (usable.renewed) {
      await storeRenewedCredentials(account.tenantId, account.id, usable.renewed);
    }
    ({ messages, customerUsername } = await fetchTikTokMessages(
      { platform: 'tiktok', externalId: account.externalId, username: account.username },
      usable.token,
      notification.conversationId,
    ));
  } catch (error) {
    if (error instanceof ProviderError) {
      if (error.reconnect) await markNeedsReconnect(account.id, error);
      return 0;
    }
    throw error;
  }

  const scope = { tenantId: account.tenantId, accountId: account.id };
  const conversationId = notification.conversationId;
  return adminDb().transaction(async (tx) => {
    const conversation = await recordConversation(tx, scope, {
      externalId: conversationId,
      participantId: conversationId,
      participantName: null,
      participantUsername: customerUsername,
    });
    let stored = 0;
    const ordered = [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    for (const message of ordered) {
      if (
        await recordMessage(tx, { ...scope, conversationId: conversation.id }, message, {
          countUnread: true,
        })
      ) {
        stored += 1;
      }
    }
    return stored;
  });
}
