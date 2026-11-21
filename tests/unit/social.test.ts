import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { customerLabel } from '@/modules/social/format';
import { checkOAuthState, createOAuthState } from '@/modules/social/oauth-state';
import { safeReason } from '@/modules/social/providers/http';
import { parseMetaWebhook, verifyMetaSignature } from '@/modules/social/providers/meta-webhook';
import { parseTikTokWebhook } from '@/modules/social/providers/tiktok';
import { previewOf } from '@/modules/social/providers/types';
import { replyWindow } from '@/modules/social/service';

const secret = 'test-app-secret-0123456789';
const sign = (body: string, key = secret) =>
  `sha256=${createHmac('sha256', key).update(body).digest('hex')}`;

describe('Meta webhook signatures', () => {
  const body = '{"object":"page","entry":[{"id":"1","note":"caf\\u00e9"}]}';
  const raw = new TextEncoder().encode(body);

  it('accepts the app secret’s signature over the raw bytes', () => {
    expect(verifyMetaSignature(raw, sign(body), secret)).toBe(true);
  });

  it('refuses another key, a changed body, a missing prefix or no header', () => {
    expect(verifyMetaSignature(raw, sign(body, 'another-secret-0123456789'), secret)).toBe(false);
    expect(verifyMetaSignature(new TextEncoder().encode(`${body} `), sign(body), secret)).toBe(
      false,
    );
    expect(verifyMetaSignature(raw, sign(body).slice('sha256='.length), secret)).toBe(false);
    expect(verifyMetaSignature(raw, null, secret)).toBe(false);
  });

  it('refuses a body re-serialised after parsing, which Meta did not sign', () => {
    const reserialised = new TextEncoder().encode(JSON.stringify(JSON.parse(body)));
    expect(verifyMetaSignature(reserialised, sign(body), secret)).toBe(false);
  });
});

describe('Meta webhook messages', () => {
  it('reads a customer’s message to a Page and the business’s echo on Instagram', () => {
    const page = parseMetaWebhook({
      object: 'page',
      entry: [
        {
          id: 'PAGE1',
          messaging: [
            {
              sender: { id: 'PSID1' },
              recipient: { id: 'PAGE1' },
              timestamp: 1_700_000_000_000,
              message: { mid: 'm1', text: 'Open on Sunday?' },
            },
          ],
        },
      ],
    });
    expect(page).toEqual([
      {
        platform: 'facebook',
        accountExternalId: 'PAGE1',
        participantId: 'PSID1',
        message: {
          externalId: 'm1',
          direction: 'inbound',
          body: 'Open on Sunday?',
          attachments: [],
          sentAt: new Date(1_700_000_000_000),
        },
      },
    ]);

    const [echo] = parseMetaWebhook({
      object: 'instagram',
      entry: [
        {
          id: 'IG1',
          messaging: [
            {
              sender: { id: 'IG1' },
              recipient: { id: 'IGSID9' },
              timestamp: 1_700_000_100_000,
              message: { mid: 'm2', text: 'Yes, 9 to 5', is_echo: true },
            },
          ],
        },
      ],
    });
    expect(echo).toMatchObject({
      platform: 'instagram',
      participantId: 'IGSID9',
      message: { direction: 'outbound', externalId: 'm2' },
    });
  });

  it('skips deleted messages, reads and other objects, and keeps only https attachment links', () => {
    const events = parseMetaWebhook({
      object: 'page',
      entry: [
        {
          id: 'PAGE1',
          messaging: [
            { sender: { id: 'P' }, recipient: { id: 'PAGE1' }, read: { watermark: 1 } },
            { sender: { id: 'P' }, message: { mid: 'gone', is_deleted: true } },
            {
              sender: { id: 'P' },
              timestamp: 1,
              message: {
                mid: 'm3',
                attachments: [
                  { type: 'image', payload: { url: 'https://cdn.example.com/a.jpg' } },
                  { type: 'file', payload: { url: 'javascript:alert(1)' } },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.message.attachments).toEqual([
      { type: 'image', url: 'https://cdn.example.com/a.jpg' },
      { type: 'file' },
    ]);
    expect(parseMetaWebhook({ object: 'whatsapp_business_account', entry: [] })).toEqual([]);
    expect(parseMetaWebhook(null)).toEqual([]);
  });
});

describe('TikTok notifications', () => {
  it('name the app, event, account and conversation, and nothing else is trusted', () => {
    expect(
      parseTikTokWebhook({
        client_key: 'app1',
        event: 'im_receive_msg',
        create_time: 1,
        user_openid: 'biz-1',
        content: JSON.stringify({ conversation_id: 'c+1==', text: { body: 'hi' } }),
      }),
    ).toEqual({
      appId: 'app1',
      event: 'im_receive_msg',
      businessId: 'biz-1',
      conversationId: 'c+1==',
      lastReadAt: null,
    });
    expect(parseTikTokWebhook({ event: 'im_receive_msg' })).toBeNull();
    expect(
      parseTikTokWebhook({ client_key: 'a', event: 'e', user_openid: 'b', content: '{not json' }),
    ).toMatchObject({ conversationId: null });
  });
});

describe('reply windows', () => {
  const now = new Date('2026-11-18T10:00:00Z');
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

  it('Messenger and Instagram: 24 hours normally, 7 days as a person, then closed', () => {
    expect(replyWindow('facebook', hoursAgo(23), now)).toEqual({ ok: true, humanAgent: false });
    expect(replyWindow('instagram', hoursAgo(25), now)).toEqual({ ok: true, humanAgent: true });
    expect(replyWindow('facebook', hoursAgo(24 * 7 + 1), now)).toMatchObject({ ok: false });
  });

  it('TikTok: 48 hours, no person exception', () => {
    expect(replyWindow('tiktok', hoursAgo(47), now)).toEqual({ ok: true, humanAgent: false });
    expect(replyWindow('tiktok', hoursAgo(49), now)).toMatchObject({ ok: false });
  });

  it('no reply before the customer has written', () => {
    expect(replyWindow('instagram', null, now)).toMatchObject({ ok: false });
  });
});

describe('connecting: the login state', () => {
  const who = { provider: 'meta' as const, tenantId: 't1', userId: 'u1' };

  it('matches only the same browser, person, business and provider, within ten minutes', () => {
    const now = 1_000_000;
    const { state, cookie } = createOAuthState('meta', 't1', 'u1', now);
    expect(checkOAuthState(cookie, state, who, now + 60_000)).toBe(true);
    expect(checkOAuthState(cookie, state, { ...who, userId: 'u2' }, now)).toBe(false);
    expect(checkOAuthState(cookie, state, { ...who, tenantId: 't2' }, now)).toBe(false);
    expect(checkOAuthState(cookie, state, { ...who, provider: 'tiktok' }, now)).toBe(false);
    expect(checkOAuthState(cookie, `${state}x`, who, now)).toBe(false);
    expect(checkOAuthState(cookie, state, who, now + 11 * 60_000)).toBe(false);
    expect(checkOAuthState(undefined, state, who, now)).toBe(false);
  });

  it('keeps only a hash of the state in the cookie', () => {
    const { state, cookie } = createOAuthState('tiktok', 't1', 'u1');
    expect(cookie).not.toContain(state);
  });
});

describe('wording', () => {
  it('previews text, or the kind of attachment', () => {
    expect(previewOf({ body: '  Two   tables\nfor six ', attachments: [] })).toBe(
      'Two tables for six',
    );
    expect(previewOf({ body: null, attachments: [{ type: 'image' }] })).toBe('[image]');
    expect(previewOf({ body: 'x'.repeat(200), attachments: [] })).toHaveLength(140);
  });

  it('never repeats a token from a provider’s error', () => {
    expect(
      safeReason(`Invalid OAuth access token - Cannot parse access token ${'EAAB'.repeat(20)}`),
    ).toBe('Invalid OAuth access token - Cannot parse access token …');
  });

  it('names a customer by name, handle, or platform', () => {
    expect(
      customerLabel({ participantName: 'Jo', participantUsername: 'jo', platform: 'tiktok' }),
    ).toBe('Jo');
    expect(
      customerLabel({ participantName: null, participantUsername: 'jo', platform: 'tiktok' }),
    ).toBe('@jo');
    expect(
      customerLabel({ participantName: null, participantUsername: null, platform: 'instagram' }),
    ).toBe('Instagram customer');
  });
});
