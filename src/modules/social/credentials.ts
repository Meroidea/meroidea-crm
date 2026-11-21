import 'server-only';

import { sql } from 'drizzle-orm';

import { decryptField, encryptField } from '@/server/crypto';
import type { Tx } from '@/server/db/with-rls';

import { refreshTikTokToken } from './providers/tiktok';
import type { SocialPlatform } from './providers/types';

/*
 * Account tokens are sealed with encryptField, bound to the business and the account, and kept
 * in social_account_credentials, which no session can read (ADR-064). Inside a person's request
 * they go through the app.social_* functions, which check the person's permission; a verified
 * webhook reads and renews them in webhooks.ts, the module's only privileged code.
 */

export type Credentials = {
  accessToken: string;
  accessExpiresAt: Date | null;
  refreshToken: string | null;
  refreshExpiresAt: Date | null;
};

export type Sealed = {
  access_token_ciphertext: string;
  access_expires_at: string | Date | null;
  refresh_token_ciphertext: string | null;
  refresh_expires_at: string | Date | null;
};

/** Ties a sealed token to its business and account, so a copied value will not open elsewhere. */
export const credentialBinding = (
  tenantId: string,
  accountId: string,
  part: 'access' | 'refresh',
) => `social:${tenantId}:${accountId}:${part}`;

const asDate = (value: string | Date | null) => (value === null ? null : new Date(value));

/** Seals tokens for one account of one business. */
export function sealCredentials(tenantId: string, accountId: string, credentials: Credentials) {
  return {
    access: encryptField(credentials.accessToken, credentialBinding(tenantId, accountId, 'access')),
    refresh: credentials.refreshToken
      ? encryptField(credentials.refreshToken, credentialBinding(tenantId, accountId, 'refresh'))
      : null,
  };
}

/** Opens tokens sealed for this account of this business. */
export function openCredentials(tenantId: string, accountId: string, row: Sealed): Credentials {
  return {
    accessToken: decryptField(
      row.access_token_ciphertext,
      credentialBinding(tenantId, accountId, 'access'),
    ),
    accessExpiresAt: asDate(row.access_expires_at),
    refreshToken: row.refresh_token_ciphertext
      ? decryptField(
          row.refresh_token_ciphertext,
          credentialBinding(tenantId, accountId, 'refresh'),
        )
      : null,
    refreshExpiresAt: asDate(row.refresh_expires_at),
  };
}

/** Stores tokens inside a person's request: social.manage to connect, social.reply to renew. */
export async function storeCredentials(
  tx: Tx,
  tenantId: string,
  accountId: string,
  credentials: Credentials,
): Promise<void> {
  const sealed = sealCredentials(tenantId, accountId, credentials);
  await tx.execute(sql`select app.social_store_credentials(
    ${accountId}::uuid, ${sealed.access}, ${credentials.accessExpiresAt?.toISOString() ?? null}::timestamptz,
    ${sealed.refresh}, ${credentials.refreshExpiresAt?.toISOString() ?? null}::timestamptz)`);
}

/** Reads tokens inside a person's request (social.reply or social.manage), or null. */
export async function readCredentials(
  tx: Tx,
  tenantId: string,
  accountId: string,
): Promise<Credentials | null> {
  const rows = (await tx.execute(
    sql`select * from app.social_read_credentials(${accountId}::uuid)`,
  )) as unknown as Sealed[];
  return rows[0] ? openCredentials(tenantId, accountId, rows[0]) : null;
}

/**
 * A usable access token. TikTok's last a day: within five minutes of expiry it is renewed with
 * the refresh token and `renewed` is returned for the caller to store. Meta's system user and
 * Page tokens do not expire.
 */
export async function usableToken(
  platform: SocialPlatform,
  credentials: Credentials,
  now = new Date(),
): Promise<{ token: string; renewed: Credentials | null }> {
  const expiring =
    credentials.accessExpiresAt !== null &&
    credentials.accessExpiresAt.getTime() - now.getTime() < 5 * 60_000;
  if (platform !== 'tiktok' || !expiring || !credentials.refreshToken) {
    return { token: credentials.accessToken, renewed: null };
  }
  const renewed = await refreshTikTokToken(credentials.refreshToken);
  return { token: renewed.accessToken, renewed };
}
