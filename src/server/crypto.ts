import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { AppError } from '@/lib/errors';
import { serverEnv } from '@/server/env';

/**
 * Field ciphertext formats. `v1` (the original) carries no key id; `v2` names the key that
 * sealed it, so several keys can be live during a rotation (ADR-040).
 *   v1.<iv>.<tag>.<body>
 *   v2.<key id>.<iv>.<tag>.<body>
 */
const LEGACY = 'v1';
const CURRENT = 'v2';

type FieldKey = { id: string; bytes: Buffer };

const UNREADABLE = 'A stored value could not be read.';

function decodeKey(encoded: string | undefined): Buffer | null {
  const decoded = encoded ? Buffer.from(encoded.trim(), 'base64') : null;
  return decoded && decoded.length === 32 ? decoded : null;
}

/** A short public fingerprint of a key: tells keys apart without revealing anything about them. */
function keyId(bytes: Buffer): string {
  return createHash('sha256')
    .update('meroidea:field-key-id')
    .update(bytes)
    .digest('hex')
    .slice(0, 16);
}

function currentKey(): FieldKey {
  const bytes = decodeKey(serverEnv().HR_ENCRYPTION_KEY);
  if (!bytes) {
    throw new AppError(
      'INTERNAL',
      'Sensitive details cannot be stored until an encryption key is set up for this system.',
    );
  }
  return { id: keyId(bytes), bytes };
}

/** Keys that are being retired: still used to read, never to write. */
function previousKeys(): FieldKey[] {
  return (serverEnv().HR_ENCRYPTION_KEYS_PREVIOUS ?? '')
    .split(',')
    .map((encoded) => decodeKey(encoded))
    .filter((bytes): bytes is Buffer => bytes !== null)
    .map((bytes) => ({ id: keyId(bytes), bytes }));
}

/** Every key that may read a value, the current one first. */
function readingKeys(): FieldKey[] {
  const current = decodeKey(serverEnv().HR_ENCRYPTION_KEY);
  const keys = current ? [{ id: keyId(current), bytes: current }] : [];
  for (const key of previousKeys()) {
    if (!keys.some((known) => known.id === key.id)) keys.push(key);
  }
  return keys;
}

export function isEncryptionConfigured(): boolean {
  return decodeKey(serverEnv().HR_ENCRYPTION_KEY) !== null;
}

/** The current key's fingerprint, or null without a key; values sealed with it start with this. */
export function currentKeyPrefix(): string | null {
  const bytes = decodeKey(serverEnv().HR_ENCRYPTION_KEY);
  return bytes ? `${CURRENT}.${keyId(bytes)}.` : null;
}

export function encryptionKeyStatus(): {
  configured: boolean;
  currentKeyId: string | null;
  previousKeyIds: string[];
} {
  const bytes = decodeKey(serverEnv().HR_ENCRYPTION_KEY);
  return {
    configured: bytes !== null,
    currentKeyId: bytes ? keyId(bytes) : null,
    previousKeyIds: previousKeys().map((key) => key.id),
  };
}

function open(key: Buffer, iv: string, tag: string, body: string, binding: string): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(binding));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(body, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * AES-256-GCM for a single field, always with the current key. `binding` ties the ciphertext to
 * the row it belongs to (tenant and record ids), so a value copied onto another row fails to
 * decrypt instead of silently showing someone else's number.
 */
export function encryptField(plaintext: string, binding: string): string {
  const key = currentKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key.bytes, iv);
  cipher.setAAD(Buffer.from(binding));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    CURRENT,
    key.id,
    ...[iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')),
  ].join('.');
}

/**
 * Reads a value sealed with the current key or any previous one. A `v2` value names its key; a
 * `v1` value does not, so each key is tried and GCM's authentication picks the right one.
 */
export function decryptField(ciphertext: string, binding: string): string {
  // With no key at all, say so plainly rather than "could not be read".
  if (readingKeys().length === 0) currentKey();
  const parts = ciphertext.split('.');
  let candidates: FieldKey[];
  let iv: string | undefined;
  let tag: string | undefined;
  let body: string | undefined;
  if (parts[0] === CURRENT && parts.length === 5) {
    candidates = readingKeys().filter((key) => key.id === parts[1]);
    [, , iv, tag, body] = parts;
  } else if (parts[0] === LEGACY && parts.length === 4) {
    candidates = readingKeys();
    [, iv, tag, body] = parts;
  } else {
    throw new AppError('INTERNAL', UNREADABLE);
  }
  for (const key of candidates) {
    try {
      return open(key.bytes, iv ?? '', tag ?? '', body ?? '', binding);
    } catch {
      // The wrong key or a tampered value; try the next key, if any.
    }
  }
  throw new AppError('INTERNAL', UNREADABLE);
}

/** True when a stored value is not yet sealed with the current key. */
export function needsReencryption(ciphertext: string): boolean {
  const prefix = currentKeyPrefix();
  return prefix !== null && !ciphertext.startsWith(prefix);
}

/** Opens a value with whichever key sealed it and seals it again with the current key. */
export function reencryptField(ciphertext: string, binding: string): string {
  return encryptField(decryptField(ciphertext, binding), binding);
}

/** A secret for a one-time link, plus the hash that is stored in its place. */
export function createLinkToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashLinkToken(token) };
}

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
