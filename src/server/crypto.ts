import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { AppError } from '@/lib/errors';
import { serverEnv } from '@/server/env';

const VERSION = 'v1';

function key(): Buffer {
  const encoded = serverEnv().HR_ENCRYPTION_KEY;
  const decoded = encoded ? Buffer.from(encoded, 'base64') : null;
  if (!decoded || decoded.length !== 32) {
    throw new AppError(
      'INTERNAL',
      'Sensitive details cannot be stored until an encryption key is set up for this system.',
    );
  }
  return decoded;
}

export function isEncryptionConfigured(): boolean {
  const encoded = serverEnv().HR_ENCRYPTION_KEY;
  return Boolean(encoded) && Buffer.from(encoded ?? '', 'base64').length === 32;
}

/**
 * AES-256-GCM for a single field. `binding` ties the ciphertext to the row it belongs to
 * (tenant and record ids), so a value copied onto another row fails to decrypt instead of
 * silently showing someone else's number.
 */
export function encryptField(plaintext: string, binding: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(binding));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), body]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

export function decryptField(ciphertext: string, binding: string): string {
  const [version, iv, tag, body] = ciphertext.split('.');
  if (version !== VERSION || !iv || !tag || !body) {
    throw new AppError('INTERNAL', 'A stored value could not be read.');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(binding));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new AppError('INTERNAL', 'A stored value could not be read.');
  }
}

/** A secret for a one-time link, plus the hash that is stored in its place. */
export function createLinkToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashLinkToken(token) };
}

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
