import { AlarmClock, MessagesSquare, Search } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { ListPagination } from '@/components/data/list-pagination';
import { withParams } from '@/components/data/url';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatRelative, initials } from '@/lib/format';
import { cn } from '@/lib/utils';

import { customerLabel, PLATFORM_LABELS } from '../format';
import { SOCIAL_INBOX_PLATFORMS, type SocialPlatform } from '../providers/types';
import type { InboxRow } from '../queries';
import { EMAIL_FOLDERS, INBOX_VIEWS, type EmailFolder, type InboxFilters } from '../schemas';
import { ChannelIcon, CustomerAvatar, PlatformBadge } from './platform-badge';

const FOLDER_LABELS: Record<EmailFolder, string> = {
  customers: 'Customers',
  review: 'To review',
  filtered: 'Filtered',
  sent: 'Sent',
  important: 'Important',
  bin: 'Bin',
};

/** What the list shows above the conversations: channels (Social inbox) or folders (Email). */
export type InboxArea =
  | {
      kind: 'social';
      /** The channels this business has connected. */
      platforms: SocialPlatform[];
      unread: { total: number; byPlatform: Partial<Record<SocialPlatform, number>> };
    }
  | { kind: 'email'; unread: Record<EmailFolder, number> };

const VIEW_LABELS: Record<(typeof INBOX_VIEWS)[number], string> = {
  open: 'Open',
  mine: 'Mine',
  unread: 'Unread',
  snoozed: 'Snoozed',
  done: 'Done',
  all: 'All',
};

/**
 * The conversation list of the Social inbox or Email (ADR-073): the left pane on a wide screen,
 * the whole screen on a phone. Filters live in the URL and follow you into a conversation, so
 * the list keeps its place.
 */
export function InboxList({
  area,
  rows,
  filters,
  nextCursor,
  activeId,
  hasAccounts,
  canManage,
}: {
  area: InboxArea;
  rows: InboxRow[];
  filters: InboxFilters;
  nextCursor: string | null;
  activeId?: string;
  hasAccounts: boolean;
  canManage: boolean;
}) {
  const basePath = area.kind === 'email' ? '/email' : '/social';
  const setupPath = area.kind === 'email' ? '/social/accounts?area=email' : '/social/accounts';
  const view = filters.view ?? 'open';
  const folder = filters.folder ?? 'customers';
  const current =
    area.kind === 'email'
      ? { view: filters.view, folder: filters.folder, q: filters.q }
      : { view: filters.view, platform: filters.platform, q: filters.q };
  // The Unread view counts what it would show: this folder, or the chosen channel.
  const unreadTotal =
    area.kind === 'email'
      ? area.unread[folder]
      : filters.platform
        ? (area.unread.byPlatform[filters.platform] ?? 0)
        : area.unread.total;
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
      <form action={basePath} className="relative border-b px-3 pt-3" role="search">
        {filters.view && <input type="hidden" name="view" value={filters.view} />}
        {area.kind === 'social' && filters.platform && (
          <input type="hidden" name="platform" value={filters.platform} />
        )}
        {area.kind === 'email' && filters.folder && (
          <input type="hidden" name="folder" value={filters.folder} />
        )}
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-5.5 mt-1.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          name="q"
          defaultValue={filters.q ?? ''}
          maxLength={100}
          placeholder={
            area.kind === 'email'
              ? 'Search name, email, subject or message'
              : 'Search name, number, handle or message'
          }
          aria-label="Search conversations"
          className="pl-8"
        />
      </form>
      {area.kind === 'email' ? (
        <nav aria-label="Email folders" className="flex border-b text-sm">
          {EMAIL_FOLDERS.map((key) => (
            <Link
              key={key}
              href={withParams(basePath, current, {
                folder: key === 'customers' ? undefined : key,
                cursor: undefined,
              })}
              aria-current={folder === key ? 'page' : undefined}
              className={cn(
                'flex flex-1 items-center justify-center gap-1 border-b-2 border-transparent px-2 py-2.5 text-muted-foreground hover:text-foreground',
                folder === key && 'border-primary font-medium text-foreground',
              )}
            >
              {FOLDER_LABELS[key]}
              {area.unread[key] > 0 && (
                <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">
                  {area.unread[key]}
                </span>
              )}
            </Link>
          ))}
        </nav>
      ) : (
        area.platforms.length > 1 && (
          <nav aria-label="Channels" className="flex flex-wrap gap-1.5 border-b p-3">
            <Link
              href={withParams(basePath, current, { platform: undefined, cursor: undefined })}
              aria-current={!filters.platform ? 'page' : undefined}
              className={cn(chip(!filters.platform), 'shrink-0 whitespace-nowrap')}
            >
              All channels
            </Link>
            {SOCIAL_INBOX_PLATFORMS.filter((platform) => area.platforms.includes(platform)).map(
              (platform) => (
                <Link
                  key={platform}
                  href={withParams(basePath, current, {
                    platform: filters.platform === platform ? undefined : platform,
                    cursor: undefined,
                  })}
                  aria-current={filters.platform === platform ? 'page' : undefined}
                  className={cn(
                    chip(filters.platform === platform),
                    'flex shrink-0 items-center gap-1.5',
                  )}
                >
                  <ChannelIcon platform={platform} className="size-3.5" />
                  {PLATFORM_LABELS[platform]}
                  {(area.unread.byPlatform[platform] ?? 0) > 0 && (
                    <span className="tabular-nums">{area.unread.byPlatform[platform]}</span>
                  )}
                </Link>
              ),
            )}
          </nav>
        )
      )}
      <nav aria-label="Filter conversations" className="flex flex-wrap gap-1.5 border-b p-3">
        {INBOX_VIEWS.map((key) => (
          <Link
            key={key}
            href={withParams(basePath, current, {
              view: key === 'open' ? undefined : key,
              cursor: undefined,
            })}
            aria-current={view === key ? 'page' : undefined}
            className={chip(view === key)}
          >
            {VIEW_LABELS[key]}
            {key === 'unread' && unreadTotal > 0 && (
              <span className="ml-1 tabular-nums">{unreadTotal}</span>
            )}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title={hasAccounts ? 'No conversations here' : 'No accounts connected yet'}
          description={
            hasAccounts
              ? filters.q
                ? 'Nothing matches that search.'
                : area.kind === 'email' && folder === 'review'
                  ? 'Emails from people who are not contacts yet appear here, to link or set aside.'
                  : area.kind === 'email' && folder === 'filtered'
                    ? 'Auto-replies, bounces, mailing lists and senders marked “Not a customer” go here.'
                    : view === 'open'
                      ? area.kind === 'email'
                        ? 'Emails from your customers appear here the moment they arrive.'
                        : 'New messages from customers appear here the moment they arrive.'
                      : view === 'mine'
                        ? 'Conversations given to you appear here.'
                        : 'Try another view.'
              : area.kind === 'email'
                ? 'Create your email inbox address to receive customers’ emails here.'
                : 'Connect WhatsApp, Facebook, Instagram, TikTok or a website chat to see customers’ messages here.'
          }
          action={
            !hasAccounts && canManage ? (
              <Button asChild>
                <Link href={setupPath}>
                  {area.kind === 'email' ? 'Set up email' : 'Connect an account'}
                </Link>
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
                  href={withParams(`${basePath}/${row.id}`, current, {})}
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
                      {row.subject && (
                        <span className="font-medium text-foreground">{row.subject} · </span>
                      )}
                      {row.lastMessagePreview ?? 'No messages yet'}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      {area.kind === 'social' && <PlatformBadge platform={row.platform} />}
                      <span className="truncate text-xs text-muted-foreground">
                        {row.contactId && row.contactName ? row.contactName : row.accountName}
                      </span>
                      {row.snoozedNow && (
                        <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
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
        pathname={basePath}
        filters={{ ...current, cursor: filters.cursor }}
        nextCursor={nextCursor}
        shown={rows.length}
      />
    </section>
  );
}
