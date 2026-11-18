import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { OAuthProvider } from './oauth-state-keys';

export const OAUTH_COOKIE = 'meroidea_social_oauth';

const TEN_MINUTES = 10 * 60_000;

const hash = (state: string) => createHash('sha256').update(state).digest('hex');

/**
 * The `state` sent to Facebook or TikTok, and the cookie that proves the browser coming back is
 * the one that left, for the same person and business. The cookie keeps only a hash of the state,
 * so neither alone is enough to finish someone else's connection.
 */
export function createOAuthState(
  provider: OAuthProvider,
  tenantId: string,
  userId: string,
  now = Date.now(),
): { state: string; cookie: string } {
  const state = randomBytes(32).toString('base64url');
  return { state, cookie: [provider, tenantId, userId, now + TEN_MINUTES, hash(state)].join('.') };
}

/** True when the returned state matches the cookie, provider, person and business, in time. */
export function checkOAuthState(
  cookie: string | undefined,
  state: string | null,
  expected: { provider: OAuthProvider; tenantId: string; userId: string },
  now = Date.now(),
): boolean {
  if (!cookie || !state) return false;
  const [provider, tenantId, userId, expires, storedHash] = cookie.split('.');
  if (
    provider !== expected.provider ||
    tenantId !== expected.tenantId ||
    userId !== expected.userId ||
    !storedHash ||
    !(Number(expires) > now)
  ) {
    return false;
  }
  const given = Buffer.from(hash(state), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return given.length === stored.length && timingSafeEqual(given, stored);
}
