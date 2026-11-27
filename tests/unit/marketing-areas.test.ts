import { describe, expect, it } from 'vitest';

import { NAVIGATION, navFeatureOn } from '@/components/layout/navigation';
import {
  receiptLabel,
  storyLabel,
  TIKTOK_REPLY_LIMIT,
  tiktokRepliesLeft,
} from '@/modules/social/channel-conventions';
import { parseMetaWebhook } from '@/modules/social/providers/meta-webhook';
import { mailboxOf, SOCIAL_INBOX_PLATFORMS } from '@/modules/social/providers/types';

// The Communication areas and each channel's own conventions (ADR-073, ADR-088).

describe('the Communication menu', () => {
  const marketing = NAVIGATION.find((group) => group.title === 'Communication')!;

  it('has exactly Social inbox, Email and Marketing campaigns', () => {
    expect(marketing.items.map((item) => ('title' in item.label ? item.label.title : ''))).toEqual([
      'Social inbox',
      'Email',
      'Marketing campaigns',
    ]);
  });

  it('shows campaigns as coming soon, never as a dead link', () => {
    expect(marketing.items[2]!.available).toBe(false);
  });

  it('shows the Social inbox for social media or live chat, and Email only with email', () => {
    const [social, email] = marketing.items;
    expect(navFeatureOn(social!, ['live_chat'])).toBe(true);
    expect(navFeatureOn(social!, ['social'])).toBe(true);
    expect(navFeatureOn(social!, ['email_channel'])).toBe(false);
    expect(navFeatureOn(email!, ['email_channel'])).toBe(true);
    expect(navFeatureOn(email!, ['social', 'live_chat'])).toBe(false);
  });
});

describe('areas', () => {
  it('email is its own area; every other channel is in the Social inbox', () => {
    expect(mailboxOf('email')).toBe('email');
    expect(SOCIAL_INBOX_PLATFORMS).not.toContain('email');
    for (const platform of SOCIAL_INBOX_PLATFORMS) expect(mailboxOf(platform)).toBe('social');
  });
});

describe('channel conventions', () => {
  it('Messenger and Instagram say Seen; WhatsApp and the rest say Read', () => {
    expect(receiptLabel('facebook', 'read')).toBe('Seen');
    expect(receiptLabel('instagram', 'read')).toBe('Seen');
    expect(receiptLabel('whatsapp', 'read')).toBe('Read');
    expect(receiptLabel('whatsapp', 'delivered')).toBe('Delivered');
    expect(receiptLabel('whatsapp', 'failed')).toBeNull();
  });

  it('counts TikTok replies since the customer last wrote', () => {
    const last = new Date('2026-11-23T10:00:00Z');
    const reply = (minutes: number, status = 'sent') => ({
      direction: 'outbound',
      status,
      sentAt: new Date(last.getTime() + minutes * 60_000),
    });
    const messages = [reply(-5), reply(1), reply(2, 'failed'), reply(3, 'read')];
    expect(tiktokRepliesLeft('tiktok', last, messages)).toBe(TIKTOK_REPLY_LIMIT - 2);
    expect(tiktokRepliesLeft('whatsapp', last, messages)).toBeNull();
    expect(tiktokRepliesLeft('tiktok', null, messages)).toBeNull();
    const many = Array.from({ length: 12 }, (_, index) => reply(index + 1));
    expect(tiktokRepliesLeft('tiktok', last, many)).toBe(0);
  });

  it('names Instagram story attachments', () => {
    expect(storyLabel('story_reply')).toBe('Replied to your story');
    expect(storyLabel('story_mention')).toBe('Mentioned you in their story');
    expect(storyLabel('image')).toBeNull();
  });
});

describe('Instagram story replies', () => {
  const event = (message: Record<string, unknown>) => ({
    object: 'instagram',
    entry: [
      {
        id: 'ig-business',
        messaging: [
          { sender: { id: 'customer' }, recipient: { id: 'ig-business' }, timestamp: 1, message },
        ],
      },
    ],
  });

  it('keeps the story a customer answered, to save before it expires', () => {
    const [parsed] = parseMetaWebhook(
      event({
        mid: 'm1',
        text: 'Love this!',
        reply_to: { story: { id: 's1', url: 'https://lookaside.fbsbx.com/story/1' } },
      }),
    );
    expect(parsed!.message.attachments).toEqual([
      { type: 'story_reply', url: 'https://lookaside.fbsbx.com/story/1' },
    ]);
    expect(parsed!.message.body).toBe('Love this!');
  });

  it('ignores a story link that is not https', () => {
    const [parsed] = parseMetaWebhook(
      event({ mid: 'm2', text: 'Hi', reply_to: { story: { url: 'javascript:alert(1)' } } }),
    );
    expect(parsed!.message.attachments).toEqual([]);
  });

  it('still reads a story mention as its own attachment', () => {
    const [parsed] = parseMetaWebhook(
      event({
        mid: 'm3',
        attachments: [
          { type: 'story_mention', payload: { url: 'https://lookaside.fbsbx.com/s/2' } },
        ],
      }),
    );
    expect(parsed!.message.attachments).toEqual([
      { type: 'story_mention', url: 'https://lookaside.fbsbx.com/s/2' },
    ]);
  });
});
