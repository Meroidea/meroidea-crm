import type { SocialPlatform } from './providers/types';

/*
 * How each channel speaks about its own messages (ADR-073), so one inbox layout still feels
 * native: WhatsApp's ticks, Messenger's and Instagram's "Seen", TikTok's reply allowance, and
 * what an Instagram story attachment is.
 */

/** TikTok allows ten replies in the 48 hours after each message from the customer. */
export const TIKTOK_REPLY_LIMIT = 10;

const COUNTED = new Set(['sending', 'sent', 'delivered', 'read']);

/** The words for a reply's state, in the channel's own terms; null when there is nothing to say. */
export function receiptLabel(platform: SocialPlatform, status: string): string | null {
  if (status === 'sending') return 'Sending…';
  if (status === 'sent') return 'Sent';
  if (status === 'delivered') return 'Delivered';
  if (status === 'read') {
    return platform === 'facebook' || platform === 'instagram' ? 'Seen' : 'Read';
  }
  return null;
}

/** How many replies TikTok still allows before the customer writes again, or null elsewhere. */
export function tiktokRepliesLeft(
  platform: SocialPlatform,
  lastInboundAt: Date | null,
  messages: { direction: string; status: string; sentAt: Date }[],
): number | null {
  if (platform !== 'tiktok' || !lastInboundAt) return null;
  const sent = messages.filter(
    (message) =>
      message.direction === 'outbound' &&
      COUNTED.has(message.status) &&
      message.sentAt.getTime() >= lastInboundAt.getTime(),
  ).length;
  return Math.max(0, TIKTOK_REPLY_LIMIT - sent);
}

/** What an Instagram story attachment is, in words; null for any other attachment. */
export function storyLabel(type: string): string | null {
  if (type === 'story_reply') return 'Replied to your story';
  if (type === 'story_mention') return 'Mentioned you in their story';
  return null;
}
