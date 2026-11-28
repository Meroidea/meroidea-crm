import { AlarmClock, Mail, Search } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { ListPagination } from '@/components/data/list-pagination';
import { withParams } from '@/components/data/url';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

import { DAY_GROUP_LABELS, groupByDay, listTime } from '../email-layout';
import { customerLabel } from '../format';
import type { InboxRow } from '../queries';
import { INBOX_VIEWS, type InboxFilters } from '../schemas';
import { FOLDER_LABELS, VIEW_LABELS } from './email-folders';
import { CustomerAvatar } from './platform-badge';

/**
 * The Email area's message list (ADR-087), laid out like a desktop mail client: sender, subject
 * and first line, grouped by day in the business's timezone, the unread ones marked with a bar.
 */
export function EmailList({
  rows,
  filters,
  nextCursor,
  activeId,
  hasAccounts,
  canManage,
  timeZone,
}: {
  rows: InboxRow[];
  filters: InboxFilters;
  nextCursor: string | null;
  activeId?: string;
  hasAccounts: boolean;
  canManage: boolean;
  timeZone: string;
}) {
  const folder = filters.folder ?? 'customers';
  const view = filters.view ?? 'open';
  const current = { view: filters.view, folder: filters.folder, q: filters.q };
  const now = new Date();
  const groups = groupByDay(rows, (row) => row.lastMessageAt, timeZone, now);

  return (
    <section
      aria-label="Email threads"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card"
    >
      <form action="/email" className="relative border-b p-3" role="search">
        {filters.view && <input type="hidden" name="view" value={filters.view} />}
        {filters.folder && <input type="hidden" name="folder" value={filters.folder} />}
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-5.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          name="q"
          defaultValue={filters.q ?? ''}
          maxLength={100}
          placeholder="Search name, email, subject or message"
          aria-label="Search email"
          className="pl-8"
        />
      </form>
      <div className="flex items-center gap-3 border-b px-3 pt-2">
        <h2 className="border-b-2 border-primary pb-2 text-sm font-semibold">
          {FOLDER_LABELS[folder]}
        </h2>
        <span className="pb-2 text-sm text-muted-foreground">{VIEW_LABELS[view]}</span>
      </div>
      <nav aria-label="Show" className="flex gap-1.5 overflow-x-auto border-b px-3 py-2 lg:hidden">
        {INBOX_VIEWS.map((key) => (
          <Link
            key={key}
            href={withParams('/email', current, { view: key === 'open' ? undefined : key })}
            aria-current={view === key ? 'page' : undefined}
            className={cn(
              'shrink-0 rounded-full border px-2.5 py-0.5 text-sm whitespace-nowrap text-muted-foreground',
              view === key && 'border-primary bg-accent font-medium text-foreground',
            )}
          >
            {VIEW_LABELS[key]}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          icon={Mail}
          title={hasAccounts ? 'Nothing here' : 'No inbox address yet'}
          description={
            hasAccounts
              ? filters.q
                ? 'Nothing matches that search.'
                : folder === 'review'
                  ? 'Emails from people who are not contacts yet appear here, to link or set aside.'
                  : folder === 'filtered'
                    ? 'Auto-replies, bounces, mailing lists and senders marked “Not a customer” go here.'
                    : folder === 'sent'
                      ? 'Emails you start wait here until the person answers.'
                      : view === 'open'
                        ? 'Emails from your customers appear here the moment they arrive.'
                        : view === 'mine'
                          ? 'Threads given to you appear here.'
                          : 'Try another view.'
              : 'Create your email inbox address to receive customers’ emails here.'
          }
          action={
            !hasAccounts && canManage ? (
              <Button asChild>
                <Link href="/social/accounts?area=email">Set up email</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.map(({ group, rows: groupRows }) => (
            <section key={group} aria-label={DAY_GROUP_LABELS[group]}>
              <h3 className="sticky top-0 z-10 border-b bg-card/95 px-3 py-1.5 text-xs font-semibold text-muted-foreground backdrop-blur">
                {DAY_GROUP_LABELS[group]}
              </h3>
              <ul className="divide-y">
                {groupRows.map((row) => {
                  const name = customerLabel(row);
                  const active = row.id === activeId;
                  const unread = row.unreadCount > 0;
                  return (
                    <li key={row.id}>
                      <Link
                        href={withParams(`/email/${row.id}`, current, {})}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'relative flex items-start gap-3 py-2.5 pr-3 pl-4 outline-none hover:bg-muted/40 focus-visible:bg-muted/60',
                          active && 'bg-accent hover:bg-accent',
                        )}
                      >
                        {(unread || active) && (
                          <span
                            aria-hidden
                            className={cn(
                              'absolute inset-y-0 left-0 w-[3px]',
                              active ? 'bg-primary' : 'bg-primary/70',
                            )}
                          />
                        )}
                        <CustomerAvatar
                          conversationId={row.id}
                          name={name}
                          hasPicture={row.hasPicture}
                          className="mt-0.5 size-8 text-xs"
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn('truncate text-sm', unread && 'font-semibold')}
                            data-sensitive
                          >
                            {name}
                            {unread && <span className="sr-only"> (unread)</span>}
                          </p>
                          <div className="flex items-baseline justify-between gap-2">
                            <p
                              className={cn(
                                'truncate text-sm',
                                unread ? 'font-semibold text-primary' : 'text-foreground',
                              )}
                              data-sensitive
                            >
                              {row.subject ?? '(no subject)'}
                            </p>
                            <span
                              className={cn(
                                'shrink-0 text-xs tabular-nums',
                                unread ? 'font-semibold text-foreground' : 'text-muted-foreground',
                              )}
                            >
                              {listTime(row.lastMessageAt, timeZone, now)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <p
                              className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                              data-sensitive
                            >
                              {row.lastMessagePreview ?? 'No messages yet'}
                            </p>
                            {row.snoozedNow && (
                              <span title="Snoozed" className="shrink-0 text-muted-foreground">
                                <AlarmClock aria-hidden className="size-3" />
                                <span className="sr-only">Snoozed</span>
                              </span>
                            )}
                            {row.assigneeName && (
                              <span
                                title={`Assigned to ${row.assigneeName}`}
                                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium"
                              >
                                <span aria-hidden>{initials(row.assigneeName)}</span>
                                <span className="sr-only">Assigned to {row.assigneeName}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      <ListPagination
        pathname="/email"
        filters={{ ...current, cursor: filters.cursor }}
        nextCursor={nextCursor}
        shown={rows.length}
      />
    </section>
  );
}
