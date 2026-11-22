import { describe, expect, it } from 'vitest';

import {
  inboxFiltersSchema,
  mediaReplySchema,
  mediaUploadSchema,
  snoozeSchema,
} from '@/modules/social/schemas';
import {
  CAPTIONS,
  mediaKind,
  mediaRefusal,
  snoozeChoices,
  windowEnds,
} from '@/modules/social/service';

const MB = 1024 * 1024;

describe('what each platform takes in a reply', () => {
  it('WhatsApp: photos to 5 MB, video and audio to 16 MB, office documents', () => {
    expect(mediaRefusal('whatsapp', 'image/jpeg', 4 * MB)).toBeNull();
    expect(mediaRefusal('whatsapp', 'image/jpeg', 6 * MB)).toMatch(/up to 5 MB/);
    expect(mediaRefusal('whatsapp', 'video/mp4', 15 * MB)).toBeNull();
    expect(
      mediaRefusal(
        'whatsapp',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        MB,
      ),
    ).toBeNull();
    expect(mediaRefusal('whatsapp', 'image/gif', MB)).toMatch(/does not take/);
  });

  it('Instagram: PDF is the only file type; TikTok: JPG and PNG to 3 MB only', () => {
    expect(mediaRefusal('instagram', 'application/pdf', MB)).toBeNull();
    expect(
      mediaRefusal(
        'instagram',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        MB,
      ),
    ).toMatch(/does not take/);
    expect(mediaRefusal('tiktok', 'image/png', 2 * MB)).toBeNull();
    expect(mediaRefusal('tiktok', 'image/png', 4 * MB)).toMatch(/up to 3 MB/);
    expect(mediaRefusal('tiktok', 'video/mp4', MB)).toMatch(/does not take/);
  });

  it('only WhatsApp and email send words with a file in one message', () => {
    expect(CAPTIONS).toEqual({
      whatsapp: true,
      email: true,
      facebook: false,
      instagram: false,
      tiktok: false,
      livechat: false,
    });
    expect(mediaKind('image/png')).toBe('image');
    expect(mediaKind('audio/ogg')).toBe('audio');
    expect(mediaKind('application/pdf')).toBe('file');
  });
});

describe('the reply window countdown', () => {
  it('ends 24 hours after the customer wrote, and 7 days for a person on Messenger', () => {
    const wrote = new Date('2026-11-20T10:00:00Z');
    expect(windowEnds('whatsapp', wrote)).toEqual({
      normal: new Date('2026-11-21T10:00:00Z'),
      human: null,
    });
    expect(windowEnds('facebook', wrote)).toEqual({
      normal: new Date('2026-11-21T10:00:00Z'),
      human: new Date('2026-11-27T10:00:00Z'),
    });
    expect(windowEnds('tiktok', wrote).normal).toEqual(new Date('2026-11-22T10:00:00Z'));
    expect(windowEnds('whatsapp', null)).toEqual({ normal: null, human: null });
  });
});

describe('snoozing', () => {
  it('offers times in the business’s own timezone', () => {
    // Friday 20 November 2026, 3 pm in Sydney (UTC+11 in summer).
    const now = new Date('2026-11-20T04:00:00Z');
    const [later, tomorrow, monday] = snoozeChoices('Australia/Sydney', now);
    expect(later?.until).toBe('2026-11-20T07:00:00.000Z');
    expect(tomorrow?.until).toBe('2026-11-20T22:00:00.000Z');
    expect(monday?.until).toBe('2026-11-22T22:00:00.000Z');
  });

  it('checks what the browser sends', () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect(snoozeSchema.safeParse({ conversationId: id, until: 'tomorrow' }).success).toBe(false);
    expect(
      snoozeSchema.safeParse({ conversationId: id, until: '2026-11-21T09:00:00+11:00' }).success,
    ).toBe(true);
    expect(
      mediaUploadSchema.safeParse({
        conversationId: id,
        fileName: 'big.mp4',
        mimeType: 'video/mp4',
        size: 20 * MB,
      }).success,
    ).toBe(false);
    expect(
      mediaReplySchema.parse({
        conversationId: id,
        path: `${id}/social/${id}/outbound/x.jpg`,
        mimeType: 'image/jpeg',
        fileName: 'x.jpg',
        caption: '',
      }).caption,
    ).toBeNull();
    expect(inboxFiltersSchema.parse({ q: '   ' }).q).toBeUndefined();
    expect(inboxFiltersSchema.parse({ view: 'mine', q: ' pizza ' })).toMatchObject({
      view: 'mine',
      q: 'pizza',
    });
  });
});
