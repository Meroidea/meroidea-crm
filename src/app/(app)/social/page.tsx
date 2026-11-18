import { MessagesSquare, Settings2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Avatar } from '@/components/data/avatar';
import { EmptyState } from '@/components/data/empty-state';
import { ListPagination } from '@/components/data/list-pagination';
import { PageHeader } from '@/components/data/page-header';
import { withParams } from '@/components/data/url';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AutoRefresh } from '@/modules/social/components/social-tools';
import { customerLabel, PLATFORM_LABELS } from '@/modules/social/format';
import { SOCIAL_PLATFORMS } from '@/modules/social/providers/types';
import { countUnread, listAccounts, listConversations } from '@/modules/social/queries';
import { inboxFiltersSchema, INBOX_VIEWS } from '@/modules/social/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Social inbox' };

const VIEW_LABELS: Record<(typeof INBOX_VIEWS)[number], string> = {
  open: 'Open',
  unread: 'Unread',
  done: 'Done',
  all: 'All',
};

export default async function SocialInboxPage({ searchParams }: PageProps<'/social'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'social.view');
  const filters = inboxFiltersSchema.parse(await searchParams);
  const view = filters.view ?? 'open';
  const [{ rows, nextCursor }, unread, { accounts }] = await Promise.all([
    listConversations(ctx, filters),
    countUnread(ctx),
    listAccounts(ctx),
  ]);
  const canManage = hasPermission(ctx, 'social.manage');
  const current = { view: filters.view, platform: filters.platform };
  const platformsConnected = new Set(accounts.map((account) => account.platform));

  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <AutoRefresh />
      <PageHeader
        title="Social inbox"
        description="Direct messages from customers on your connected Facebook, Instagram and TikTok accounts."
        actions={
          canManage && (
            <Button asChild variant="outline">
              <Link href="/social/accounts">
                <Settings2 aria-hidden /> Connected accounts
              </Link>
            </Button>
          )
        }
      />

      <nav aria-label="Conversations" className="flex flex-wrap items-center gap-2">
        {INBOX_VIEWS.map((key) => (
          <Link
            key={key}
            href={withParams('/social', current, { view: key === 'open' ? undefined : key })}
            aria-current={view === key ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-sm text-muted-foreground hover:text-foreground',
              view === key && 'border-primary bg-accent font-medium text-foreground',
            )}
          >
            {VIEW_LABELS[key]}
            {key === 'unread' && unread > 0 && <span className="ml-1 tabular-nums">{unread}</span>}
          </Link>
        ))}
        <span className="mx-1 hidden h-5 border-l sm:block" />
        {SOCIAL_PLATFORMS.filter((platform) => platformsConnected.has(platform)).map((platform) => (
          <Link
            key={platform}
            href={withParams('/social', current, {
              platform: filters.platform === platform ? undefined : platform,
            })}
            aria-current={filters.platform === platform ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-sm text-muted-foreground hover:text-foreground',
              filters.platform === platform &&
                'border-primary bg-accent font-medium text-foreground',
            )}
          >
            {PLATFORM_LABELS[platform]}
          </Link>
        ))}
      </nav>

      <Card className="gap-0 py-0">
        {rows.length === 0 ? (
          <CardContent>
            <EmptyState
              icon={MessagesSquare}
              title={accounts.length === 0 ? 'No accounts connected yet' : 'No conversations here'}
              description={
                accounts.length === 0
                  ? 'Connect your Facebook Page, Instagram or TikTok account to see customers’ messages here.'
                  : view === 'open'
                    ? 'New messages from customers will appear here as they arrive.'
                    : 'Try another view.'
              }
              action={
                accounts.length === 0 && canManage ? (
                  <Button asChild>
                    <Link href="/social/accounts">Connect an account</Link>
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => {
              const name = customerLabel(row);
              return (
                <li key={row.id}>
                  <Link
                    href={`/social/${row.id}`}
                    className="flex items-start gap-3 px-4 py-3 outline-none hover:bg-muted/40 focus-visible:bg-muted/60"
                  >
                    <Avatar name={name} className="mt-0.5 size-9 text-xs" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span
                          className={cn('truncate', row.unreadCount > 0 && 'font-semibold')}
                          data-sensitive
                        >
                          {name}
                        </span>
                        <Badge variant="outline">{PLATFORM_LABELS[row.platform]}</Badge>
                        {row.contactId && (
                          <span className="truncate text-xs text-muted-foreground" data-sensitive>
                            {row.contactName ? `· ${row.contactName}` : '· linked'}
                          </span>
                        )}
                      </div>
                      <p
                        className={cn(
                          'mt-0.5 truncate text-sm text-muted-foreground',
                          row.unreadCount > 0 && 'text-foreground',
                        )}
                        data-sensitive
                      >
                        {row.lastMessagePreview ?? 'No messages yet'}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        to {row.accountName}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatRelative(row.lastMessageAt)}
                      </span>
                      {row.unreadCount > 0 && (
                        <span className="rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground tabular-nums">
                          {row.unreadCount}
                        </span>
                      )}
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
      </Card>
    </div>
  );
}
