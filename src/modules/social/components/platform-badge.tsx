import { Avatar } from '@/components/data/avatar';
import { cn } from '@/lib/utils';

import { PLATFORM_LABELS } from '../format';
import type { SocialPlatform } from '../providers/types';

/** Each platform keeps one colour everywhere; the label carries the meaning, never colour alone. */
const DOT: Record<SocialPlatform, string> = {
  facebook: 'bg-chart-1',
  instagram: 'bg-chart-5',
  tiktok: 'bg-foreground',
  whatsapp: 'bg-chart-2',
  email: 'bg-chart-3',
};

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
      <span aria-hidden className={cn('size-2 rounded-full', DOT[platform])} />
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
