import { MessagesSquare } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { ListPagination } from '@/components/data/list-pagination';
import { withParams } from '@/components/data/url';
import { Button } from '@/components/ui/button';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

import { customerLabel, PLATFORM_LABELS } from '../format';
import { SOCIAL_PLATFORMS, type SocialPlatform } from '../providers/types';
import type { InboxRow } from '../queries';
import { INBOX_VIEWS, type InboxFilters } from '../schemas';
import { CustomerAvatar, PlatformBadge } from './platform-badge';

const VIEW_LABELS: Record<(typeof INBOX_VIEWS)[number], string> = {
  open: 'Open',
  unread: 'Unread',
  done: 'Done',
  all: 'All',
};

/**
 * The conversation list: the left pane on a wide screen, the whole screen on a phone. Filters
 * live in the URL and follow you into a conversation, so the list keeps its place.
 */
export function InboxList({
  rows,
  filters,
  nextCursor,
  unread,
  platforms,
  activeId,
  hasAccounts,
  canManage,
}: {
  rows: InboxRow[];
  filters: InboxFilters;
  nextCursor: string | null;
  unread: number;
  platforms: SocialPlatform[];
  activeId?: string;
  hasAccounts: boolean;
  canManage: boolean;
}) {
  const view = filters.view ?? 'open';
  const current = { view: filters.view, platform: filters.platform };
  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-2.5 py-0.5 text-sm text-muted-foreground hover:text-foreground',
      active && 'border-primary bg-accent font-medium text-foreground',
    );

  return (
    <section
      aria-label="Conversations"
      className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card"
    >
      <nav aria-label="Filter conversations" className="flex flex-wrap gap-1.5 border-b p-3">
        {INBOX_VIEWS.map((key) => (
          <Link
            key={key}
            href={withParams('/social', current, { view: key === 'open' ? undefined : key })}
            aria-current={view === key ? 'page' : undefined}
            className={chip(view === key)}
          >
            {VIEW_LABELS[key]}
            {key === 'unread' && unread > 0 && <span className="ml-1 tabular-nums">{unread}</span>}
          </Link>
        ))}
        {platforms.length > 1 &&
          SOCIAL_PLATFORMS.filter((platform) => platforms.includes(platform)).map((platform) => (
            <Link
              key={platform}
              href={withParams('/social', current, {
                platform: filters.platform === platform ? undefined : platform,
              })}
              aria-current={filters.platform === platform ? 'page' : undefined}
              className={chip(filters.platform === platform)}
            >
              {PLATFORM_LABELS[platform]}
            </Link>
          ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title={hasAccounts ? 'No conversations here' : 'No accounts connected yet'}
          description={
            hasAccounts
              ? view === 'open'
                ? 'New messages from customers appear here the moment they arrive.'
                : 'Try another view.'
              : 'Connect your Facebook Page, Instagram or TikTok account to see customers’ messages here.'
          }
          action={
            !hasAccounts && canManage ? (
              <Button asChild>
                <Link href="/social/accounts">Connect an account</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
          {rows.map((row) => {
            const name = customerLabel(row);
            const active = row.id === activeId;
            return (
              <li key={row.id}>
                <Link
                  href={withParams(`/social/${row.id}`, current, {})}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-start gap-3 px-3 py-3 outline-none hover:bg-muted/40 focus-visible:bg-muted/60',
                    active && 'bg-accent',
                  )}
                >
                  <CustomerAvatar
                    conversationId={row.id}
                    name={name}
                    hasPicture={row.hasPicture}
                    className="mt-0.5 size-9 text-xs"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn('truncate', row.unreadCount > 0 && 'font-semibold')}
                        data-sensitive
                      >
                        {name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatRelative(row.lastMessageAt)}
                      </span>
                    </div>
                    <p
                      className={cn(
                        'truncate text-sm text-muted-foreground',
                        row.unreadCount > 0 && 'text-foreground',
                      )}
                      data-sensitive
                    >
                      {row.lastMessagePreview ?? 'No messages yet'}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <PlatformBadge platform={row.platform} />
                      <span className="truncate text-xs text-muted-foreground">
                        {row.contactId && row.contactName ? row.contactName : row.accountName}
                      </span>
                      {row.unreadCount > 0 && (
                        <span className="ml-auto rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground tabular-nums">
                          {row.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <ListPagination
        pathname="/social"
        filters={{ ...current, cursor: filters.cursor }}
        nextCursor={nextCursor}
        shown={rows.length}
      />
    </section>
  );
}
