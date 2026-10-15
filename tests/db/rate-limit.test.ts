import { randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { consumeRateLimit, rateLimitReached } from '@/server/rate-limit';

// Sign-in runs inside a request; these stand in for its headers and for the auth server, whose
// answer depends only on the password here.
const request = vi.hoisted(() => ({ address: '198.51.100.7' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-real-ip': request.address }),
}));
vi.mock('@/server/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signInWithPassword: async ({ password }: { password: string }) => ({
        error: password === 'right-password' ? null : { message: 'Invalid login credentials' },
      }),
    },
  }),
}));

const { signInAction } = await import('@/modules/auth/actions');

const unique = () => randomBytes(6).toString('hex');
const signIn = (email: string, password: string) => signInAction({ email, password });

describe('rate limits', () => {
  it('counts only what is consumed, and reports the limit without counting a check', async () => {
    const limit = { bucket: `test:${unique()}`, subject: 'someone', limit: 2, windowSeconds: 60 };
    expect(await rateLimitReached(limit)).toBe(false);
    expect(await consumeRateLimit(limit)).toBe(true);
    expect(await rateLimitReached(limit)).toBe(false);
    expect(await consumeRateLimit(limit)).toBe(true);
    expect(await rateLimitReached(limit)).toBe(true);
    expect(await consumeRateLimit(limit)).toBe(false);
  });
});

describe('signing in', () => {
  it('stops one sender guessing an account’s password, without locking out its owner', async () => {
    request.address = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const email = `guessed-${unique()}@example.com`;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await signIn(email, `wrong-${attempt}`);
      expect(result.ok ? 'OK' : result.error.code).toBe('UNAUTHENTICATED');
    }
    const blocked = await signIn(email, 'right-password');
    expect(blocked.ok ? 'OK' : blocked.error.code).toBe('RATE_LIMITED');

    // The guesser only locked themselves out: the account's owner, elsewhere, still gets in.
    request.address = `198.51.100.${(Number(request.address.split('.').pop()) % 200) + 30}`;
    expect((await signIn(email, 'right-password')).ok).toBe(true);
  });

  it('does not let failures on one account lock out another, or count successful sign-ins', async () => {
    request.address = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const owner = `owner-${unique()}@example.com`;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      expect((await signIn(owner, 'right-password')).ok).toBe(true);
    }
    expect((await signIn(`other-${unique()}@example.com`, 'right-password')).ok).toBe(true);
  });

  it('stops one sender trying many accounts', async () => {
    request.address = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
    const codes: string[] = [];
    for (let attempt = 0; attempt < 41; attempt += 1) {
      const result = await signIn(`spray-${unique()}@example.com`, 'wrong');
      codes.push(result.ok ? 'OK' : result.error.code);
    }
    expect(codes.slice(0, 40).every((code) => code === 'UNAUTHENTICATED')).toBe(true);
    expect(codes[40]).toBe('RATE_LIMITED');
  });
});
