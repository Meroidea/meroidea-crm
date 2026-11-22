import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

/**
 * Tracked article links (ADR-071): the address carries a random token, and only its hash is
 * stored, so the table never holds something that opens a link and the link never names a person.
 */
export function newLinkToken(): string {
  return randomBytes(24).toString('base64url');
}

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}
