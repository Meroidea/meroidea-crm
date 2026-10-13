import { randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const env: { HR_ENCRYPTION_KEY?: string; HR_ENCRYPTION_KEYS_PREVIOUS?: string } = {};
vi.mock('@/server/env', () => ({ serverEnv: () => env }));

const {
  currentKeyPrefix,
  decryptField,
  encryptField,
  encryptionKeyStatus,
  needsReencryption,
  reencryptField,
} = await import('@/server/crypto');

const newKey = () => randomBytes(32).toString('base64');
const binding = 'tenant:employee:tfn';

/** A value in the original v1 format, which named no key. */
async function legacyCiphertext(key: string, plaintext: string): Promise<string> {
  const { createCipheriv } = await import('node:crypto');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
  cipher.setAAD(Buffer.from(binding));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), body]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

beforeEach(() => {
  delete env.HR_ENCRYPTION_KEY;
  delete env.HR_ENCRYPTION_KEYS_PREVIOUS;
});

describe('field encryption with key rotation', () => {
  it('seals with the current key and names it, without revealing the key', () => {
    env.HR_ENCRYPTION_KEY = newKey();
    const sealed = encryptField('123456789', binding);
    expect(sealed.startsWith(currentKeyPrefix()!)).toBe(true);
    expect(sealed).not.toContain(env.HR_ENCRYPTION_KEY);
    expect(decryptField(sealed, binding)).toBe('123456789');
    expect(needsReencryption(sealed)).toBe(false);
  });

  it('refuses a value moved onto another row', () => {
    env.HR_ENCRYPTION_KEY = newKey();
    const sealed = encryptField('123456789', binding);
    expect(() => decryptField(sealed, 'tenant:someone-else:tfn')).toThrow('could not be read');
  });

  it('still reads values sealed with a previous key, and moves them onto the new one', () => {
    const oldKey = newKey();
    env.HR_ENCRYPTION_KEY = oldKey;
    const sealedOld = encryptField('062-000 1234', binding);

    env.HR_ENCRYPTION_KEY = newKey();
    env.HR_ENCRYPTION_KEYS_PREVIOUS = oldKey;
    expect(needsReencryption(sealedOld)).toBe(true);
    expect(decryptField(sealedOld, binding)).toBe('062-000 1234');

    const resealed = reencryptField(sealedOld, binding);
    expect(needsReencryption(resealed)).toBe(false);

    delete env.HR_ENCRYPTION_KEYS_PREVIOUS;
    expect(decryptField(resealed, binding)).toBe('062-000 1234');
    expect(() => decryptField(sealedOld, binding)).toThrow('could not be read');
  });

  it('reads the original v1 format under the current or a previous key', async () => {
    const oldKey = newKey();
    const legacy = await legacyCiphertext(oldKey, '987654321');
    env.HR_ENCRYPTION_KEY = oldKey;
    expect(decryptField(legacy, binding)).toBe('987654321');
    expect(needsReencryption(legacy)).toBe(true);

    env.HR_ENCRYPTION_KEY = newKey();
    env.HR_ENCRYPTION_KEYS_PREVIOUS = `${newKey()},${oldKey}`;
    expect(decryptField(legacy, binding)).toBe('987654321');
  });

  it('reports the keys in play, ignoring malformed previous keys', () => {
    env.HR_ENCRYPTION_KEY = newKey();
    env.HR_ENCRYPTION_KEYS_PREVIOUS = `${newKey()}, not-a-key ,`;
    const status = encryptionKeyStatus();
    expect(status.configured).toBe(true);
    expect(status.currentKeyId).toMatch(/^[0-9a-f]{16}$/);
    expect(status.previousKeyIds).toHaveLength(1);
  });

  it('says plainly when no key is set up', () => {
    expect(encryptionKeyStatus().configured).toBe(false);
    expect(() => encryptField('1', binding)).toThrow('encryption key');
    expect(() => decryptField('v2.abc.a.b.c', binding)).toThrow('encryption key');
  });

  it('rejects anything that is not a known format', () => {
    env.HR_ENCRYPTION_KEY = newKey();
    expect(() => decryptField('v3.a.b.c', binding)).toThrow('could not be read');
    expect(() => decryptField('garbage', binding)).toThrow('could not be read');
  });
});
