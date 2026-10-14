import { Bell } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

/** Header link to the notifications page, with the unread count. */
export function NotificationBell({ unread }: { unread: number }) {
  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';
  return (
    <Button asChild variant="ghost" size="icon" className="relative">
      <Link href="/notifications" aria-label={label} title={label}>
        <Bell aria-hidden />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Link>
    </Button>
  );
}
