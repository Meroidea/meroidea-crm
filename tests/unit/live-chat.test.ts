import { describe, expect, it } from 'vitest';

import {
  chatMessageSchema,
  chatSessionSchema,
  chatWidgetSchema,
  WIDGET_KEY,
} from '@/modules/social/livechat-schemas';

// Live chat inputs (ADR-072).

const widget = (allowedOrigins: string[]) =>
  chatWidgetSchema.safeParse({ name: 'Help', allowedOrigins, requireEmail: false });

describe('live chat inputs', () => {
  it('accepts https sites, tidied, and localhost for trying it out', () => {
    const parsed = widget(['HTTPS://WWW.Example.com/', 'http://localhost:3000']);
    expect(parsed.success && parsed.data.allowedOrigins).toEqual([
      'https://www.example.com',
      'http://localhost:3000',
    ]);
  });

  it('refuses anything that is not a bare https origin', () => {
    for (const site of [
      'http://www.example.com',
      'https://www.example.com/page',
      'javascript:alert(1)',
      "https://example.com 'unsafe-inline'",
      '*',
      'https://*.example.com',
    ]) {
      expect(widget([site]).success, site).toBe(false);
    }
  });

  it('parses its own output again unchanged, as the form and then the action do', () => {
    const first = chatWidgetSchema.parse({
      name: 'Help',
      allowedOrigins: ['https://shop.example.com/'],
      greeting: '',
      requireEmail: false,
    });
    expect(chatWidgetSchema.parse(first)).toEqual(first);
    expect(first.greeting).toBeNull();
  });

  it('allows at most ten sites', () => {
    const many = Array.from({ length: 11 }, (_, index) => `https://s${index}.example.com`);
    expect(widget(many).success).toBe(false);
  });

  it('takes a visitor token only in its own shape', () => {
    expect(chatSessionSchema.safeParse({ token: 'short' }).success).toBe(false);
    expect(chatSessionSchema.safeParse({ token: 'a'.repeat(32) }).success).toBe(true);
  });

  it('needs a hex HMAC-SHA256 for a signed identity', () => {
    const identity = { email: 'Pat@Example.com', signature: 'f'.repeat(64) };
    const parsed = chatSessionSchema.safeParse({ identity });
    expect(parsed.success && parsed.data.identity?.email).toBe('pat@example.com');
    expect(
      chatSessionSchema.safeParse({ identity: { ...identity, signature: 'xyz' } }).success,
    ).toBe(false);
  });

  it('keeps a message to 2,000 characters and needs a client id for retries', () => {
    const base = { token: 'a'.repeat(32), clientId: crypto.randomUUID() };
    expect(chatMessageSchema.safeParse({ ...base, body: 'x'.repeat(2001) }).success).toBe(false);
    expect(chatMessageSchema.safeParse({ ...base, body: '   ' }).success).toBe(false);
    expect(chatMessageSchema.safeParse({ ...base, clientId: 'nope', body: 'hi' }).success).toBe(
      false,
    );
  });

  it('widget keys are 24 url-safe characters', () => {
    expect(WIDGET_KEY.test('A'.repeat(24))).toBe(true);
    expect(WIDGET_KEY.test('A'.repeat(23))).toBe(false);
    expect(WIDGET_KEY.test(`${'A'.repeat(23)}/`)).toBe(false);
  });
});
