import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { acceptedType, allowedMediaUrl, downloadMedia, MediaRefused } from '@/modules/social/media';
import { isRateLimited, minutesUntilAllowed } from '@/modules/social/providers/http';
import { parseMetaReceipts } from '@/modules/social/providers/meta-webhook';
import { parseTikTokWebhook, verifyTikTokSignature } from '@/modules/social/providers/tiktok';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode('ftypmp42')]);
const HTML = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('which media addresses are fetched', () => {
  it('allows only https on the platforms’ media hosts', () => {
    expect(allowedMediaUrl('https://scontent.xx.fbcdn.net/v/t1/a.jpg?oh=1')).toBe(true);
    expect(allowedMediaUrl('https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1')).toBe(true);
    expect(allowedMediaUrl('https://p16-sign.tiktokcdn-us.com/obj/x')).toBe(true);
    expect(allowedMediaUrl('http://scontent.xx.fbcdn.net/a.jpg')).toBe(false);
    expect(allowedMediaUrl('https://fbcdn.net.evil.example.com/a.jpg')).toBe(false);
    expect(allowedMediaUrl('https://evilfbcdn.net/a.jpg')).toBe(false);
    expect(allowedMediaUrl('https://user:pass@scontent.fbcdn.net/a.jpg')).toBe(false);
    expect(allowedMediaUrl('https://scontent.fbcdn.net:8443/a.jpg')).toBe(false);
    expect(allowedMediaUrl('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(allowedMediaUrl('not a url')).toBe(false);
  });

  it('accepts a file only when its first bytes match a type we keep', () => {
    expect(acceptedType('image/jpeg', JPEG)).toEqual({ mimeType: 'image/jpeg', ext: 'jpg' });
    expect(acceptedType('video/mp4', MP4)).toEqual({ mimeType: 'video/mp4', ext: 'mp4' });
    expect(acceptedType('application/octet-stream', PNG)).toEqual({
      mimeType: 'image/png',
      ext: 'png',
    });
    expect(acceptedType('image/jpeg', HTML)).toBeNull();
    expect(acceptedType('text/html', HTML)).toBeNull();
    expect(acceptedType('image/svg+xml', new TextEncoder().encode('<svg/>'))).toBeNull();
  });
});

describe('downloading media', () => {
  const respond = (body: Uint8Array, headers: Record<string, string>, status = 200) =>
    new Response(status >= 300 && status < 400 ? null : new Blob([new Uint8Array(body)]), {
      status,
      headers,
    });

  it('follows a redirect to another media host, checking it first', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        respond(new Uint8Array(), { location: 'https://scontent-b.xx.fbcdn.net/a.jpg' }, 302),
      )
      .mockResolvedValueOnce(respond(JPEG, { 'content-type': 'image/jpeg' }));
    const file = await downloadMedia('https://lookaside.fbsbx.com/x');
    expect(file.mimeType).toBe('image/jpeg');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });

  it('never follows a redirect off the media hosts', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        respond(new Uint8Array(), { location: 'http://127.0.0.1:54322/' }, 302),
      );
    await expect(downloadMedia('https://scontent.fbcdn.net/a.jpg')).rejects.toBeInstanceOf(
      MediaRefused,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses files over the cap, declared or streamed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      respond(JPEG, { 'content-type': 'image/jpeg', 'content-length': String(30 * 1024 * 1024) }),
    );
    await expect(downloadMedia('https://scontent.fbcdn.net/a.jpg')).rejects.toThrow('too large');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      respond(new Uint8Array(2048), { 'content-type': 'image/jpeg' }),
    );
    await expect(
      downloadMedia('https://scontent.fbcdn.net/a.jpg', { limit: 1024 }),
    ).rejects.toThrow('too large');
  });

  it('refuses a page dressed up as an image, and video where only pictures belong', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      respond(HTML, { 'content-type': 'image/jpeg' }),
    );
    await expect(downloadMedia('https://scontent.fbcdn.net/a.jpg')).rejects.toThrow(
      'type not accepted',
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      respond(MP4, { 'content-type': 'video/mp4' }),
    );
    await expect(
      downloadMedia('https://scontent.fbcdn.net/a.mp4', { imagesOnly: true }),
    ).rejects.toThrow('type not accepted');
  });
});

describe('TikTok signatures', () => {
  const secret = 'tiktok-secret-0123456789';
  const body = new TextEncoder().encode('{"event":"im_mark_read_msg"}');
  const sign = (t: number, key = secret) =>
    `t=${t},s=${createHmac('sha256', key).update(`${t}.`).update(body).digest('hex')}`;
  const now = 1_800_000_000_000;

  it('accepts the app secret’s signature within five minutes', () => {
    expect(verifyTikTokSignature(body, sign(now / 1000), secret, now)).toBe(true);
    expect(verifyTikTokSignature(body, sign(now / 1000 - 240), secret, now)).toBe(true);
  });

  it('refuses another key, a replay, a changed body or a malformed header', () => {
    expect(
      verifyTikTokSignature(body, sign(now / 1000, 'another-secret-012345'), secret, now),
    ).toBe(false);
    expect(verifyTikTokSignature(body, sign(now / 1000 - 301), secret, now)).toBe(false);
    expect(
      verifyTikTokSignature(new TextEncoder().encode('{}'), sign(now / 1000), secret, now),
    ).toBe(false);
    expect(verifyTikTokSignature(body, 'garbage', secret, now)).toBe(false);
    expect(verifyTikTokSignature(body, null, secret, now)).toBe(false);
  });

  it('reads a read receipt’s time', () => {
    expect(
      parseTikTokWebhook({
        client_key: 'a',
        event: 'im_mark_read_msg',
        user_openid: 'b',
        content: JSON.stringify({
          conversation_id: 'c1',
          read: { last_read_timestamp: 1_700_000_000_000 },
        }),
      }),
    ).toMatchObject({ conversationId: 'c1', lastReadAt: new Date(1_700_000_000_000) });
  });
});

describe('rate limits', () => {
  it('recognises Meta’s throttling codes and HTTP 429, and nothing else', () => {
    for (const code of [4, 17, 32, 613, 80001, 80002, 80006, '80006']) {
      expect(isRateLimited(400, code)).toBe(true);
    }
    expect(isRateLimited(429, null)).toBe(true);
    for (const code of [10, 100, 190, 551, 80015]) expect(isRateLimited(400, code)).toBe(false);
  });

  it('reads how long Meta says to wait, taking the longest', () => {
    const headers = new Headers({
      'x-business-use-case-usage': JSON.stringify({
        '123': [
          { type: 'messenger', call_count: 100, estimated_time_to_regain_access: 3 },
          { type: 'pages', call_count: 90, estimated_time_to_regain_access: 7 },
        ],
      }),
    });
    expect(minutesUntilAllowed(headers)).toBe(7);
    expect(minutesUntilAllowed(new Headers())).toBeNull();
    expect(minutesUntilAllowed(new Headers({ 'x-business-use-case-usage': '{nope' }))).toBeNull();
  });
});

describe('Meta receipts', () => {
  it('reads Messenger deliveries and reads, and Instagram’s seen', () => {
    const page = parseMetaReceipts({
      object: 'page',
      entry: [
        {
          id: 'PAGE1',
          messaging: [
            {
              sender: { id: 'P1' },
              recipient: { id: 'PAGE1' },
              delivery: { mids: ['m1'], watermark: 1000 },
            },
            {
              sender: { id: 'P1' },
              recipient: { id: 'PAGE1' },
              timestamp: 3,
              read: { watermark: 2000 },
            },
            { sender: { id: 'P1' }, message: { mid: 'not-a-receipt' } },
          ],
        },
      ],
    });
    expect(page).toEqual([
      {
        platform: 'facebook',
        accountExternalId: 'PAGE1',
        participantId: 'P1',
        kind: 'delivered',
        watermark: new Date(1000),
        mids: ['m1'],
      },
      {
        platform: 'facebook',
        accountExternalId: 'PAGE1',
        participantId: 'P1',
        kind: 'read',
        watermark: new Date(2000),
        mids: [],
      },
    ]);
    const [seen] = parseMetaReceipts({
      object: 'instagram',
      entry: [
        {
          id: 'IG1',
          messaging: [{ sender: { id: 'IGSID' }, recipient: { id: 'IG1' }, read: { mid: 'm9' } }],
        },
      ],
    });
    expect(seen).toMatchObject({
      platform: 'instagram',
      kind: 'read',
      watermark: null,
      mids: ['m9'],
    });
  });
});
