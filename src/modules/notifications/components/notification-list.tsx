'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { markNotificationReadAction } from '@/modules/notifications/actions';

export function NotificationList({
  items,
}: {
  items: {
    id: string;
    title: string;
    body: string | null;
    url: string | null;
    unread: boolean;
    when: string;
  }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const open = (item: (typeof items)[number]) =>
    startTransition(async () => {
      if (item.unread) await markNotificationReadAction({ id: item.id });
      if (item.url && item.url.startsWith('/')) router.push(item.url);
      else router.refresh();
    });

  return (
    <div className="flex flex-col">
      {items.some((item) => item.unread) && (
        <div className="flex justify-end border-b px-4 py-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await markNotificationReadAction({ id: 'all' });
                router.refresh();
              })
            }
          >
            Mark all as read
          </Button>
        </div>
      )}
      <ul className="flex flex-col divide-y">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => open(item)}
              className={cn(
                'flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50',
                item.unread && 'bg-primary/5',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'mt-1.5 size-2 shrink-0 rounded-full',
                  item.unread ? 'bg-primary' : 'bg-transparent',
                )}
              />
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm', item.unread && 'font-medium')}>
                  {item.title}
                </span>
                {item.body && (
                  <span className="block text-sm text-muted-foreground">{item.body}</span>
                )}
                <span className="block text-xs text-muted-foreground">{item.when}</span>
              </span>
              {item.unread && <span className="sr-only">Unread</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
