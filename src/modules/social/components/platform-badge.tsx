import { Mail, MessageCircle } from 'lucide-react';

import { Avatar } from '@/components/data/avatar';
import { cn } from '@/lib/utils';

import { PLATFORM_LABELS } from '../format';
import type { SocialPlatform } from '../providers/types';
import { CHANNEL_PATHS } from './channel-icons';

/** Each channel's colour as a text colour, for its mark (ADR-073). */
export const CHANNEL_TEXT: Record<SocialPlatform, string> = {
  facebook: 'text-channel-facebook',
  instagram: 'text-channel-instagram',
  tiktok: 'text-channel-tiktok',
  whatsapp: 'text-channel-whatsapp',
  email: 'text-channel-email',
  livechat: 'text-channel-livechat',
};

/** A light tint of each channel's colour, for the business's own message bubbles. */
export const CHANNEL_TINT: Record<SocialPlatform, string> = {
  facebook: 'bg-channel-facebook/12',
  instagram: 'bg-channel-instagram/10',
  tiktok: 'bg-channel-tiktok/8',
  whatsapp: 'bg-channel-whatsapp/18',
  email: 'bg-channel-email/15',
  livechat: 'bg-channel-livechat/15',
};

/** Each channel's colour as a border, for the top edge of a conversation. */
export const CHANNEL_BORDER: Record<SocialPlatform, string> = {
  facebook: 'border-t-channel-facebook',
  instagram: 'border-t-channel-instagram',
  tiktok: 'border-t-channel-tiktok',
  whatsapp: 'border-t-channel-whatsapp',
  email: 'border-t-channel-email',
  livechat: 'border-t-channel-livechat',
};

/** A channel's own mark (email and live chat, which have none, use plain icons). Decorative. */
export function ChannelIcon({
  platform,
  className,
}: {
  platform: SocialPlatform;
  className?: string;
}) {
  const classes = cn('size-3.5 shrink-0', CHANNEL_TEXT[platform], className);
  if (platform === 'email') return <Mail aria-hidden className={classes} />;
  if (platform === 'livechat') return <MessageCircle aria-hidden className={classes} />;
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={classes}>
      <path d={CHANNEL_PATHS[platform]} />
    </svg>
  );
}

/** Where a conversation came from: the channel's mark and its name. */
export function PlatformBadge({
  platform,
  className,
}: {
  platform: SocialPlatform;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        className,
      )}
    >
      <ChannelIcon platform={platform} className="size-3" />
      {PLATFORM_LABELS[platform]}
    </span>
  );
}

/** The customer's saved picture, or their initials while there is none. */
export function CustomerAvatar({
  conversationId,
  name,
  hasPicture,
  className,
}: {
  conversationId: string;
  name: string;
  hasPicture: boolean;
  className?: string;
}) {
  if (!hasPicture) return <Avatar name={name} className={className} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a one-minute signed redirect per request; nothing for the image optimiser to cache
    <img
      src={`/api/social/avatar/${conversationId}`}
      alt=""
      loading="lazy"
      className={cn('size-7 shrink-0 rounded-full object-cover', className)}
    />
  );
}
