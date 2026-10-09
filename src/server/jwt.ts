import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

/*
 * HS256 JSON Web Tokens and plain HMAC signatures, on Node's own crypto. Used for the exchange
 * with the document editing server, which signs and expects exactly this.
 */

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

export function hmac(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('base64url');
}

/** Compares two signatures without leaking where they differ. */
export function sameSignature(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function signJwt(payload: object, secret: string): string {
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`;
  return `${body}.${hmac(secret, body)}`;
}

/** The payload of a token signed with `secret`, or null when it is malformed, forged or expired. */
export function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) return null;
  if (!sameSignature(signature, hmac(secret, `${header}.${payload}`))) return null;
  try {
    const { alg } = JSON.parse(Buffer.from(header, 'base64url').toString()) as { alg?: string };
    if (alg !== 'HS256') return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}
