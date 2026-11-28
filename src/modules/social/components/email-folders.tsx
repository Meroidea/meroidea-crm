import {
  AlarmClock,
  CircleCheck,
  Filter,
  Inbox,
  Layers,
  Mail,
  MailOpen,
  Send,
  Settings2,
  User,
  UserSearch,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import { withParams } from '@/components/data/url';
import { cn } from '@/lib/utils';

import { EMAIL_FOLDERS, INBOX_VIEWS, type EmailFolder, type InboxFilters } from '../schemas';

export const FOLDER_LABELS: Record<EmailFolder, string> = {
  customers: 'Customers',
  review: 'To review',
  filtered: 'Filtered',
  sent: 'Sent',
};

const FOLDER_ICONS: Record<EmailFolder, LucideIcon> = {
  customers: Inbox,
  review: UserSearch,
  filtered: Filter,
  sent: Send,
};

export const VIEW_LABELS: Record<(typeof INBOX_VIEWS)[number], string> = {
  open: 'Open',
  mine: 'Assigned to me',
  unread: 'Unread',
  snoozed: 'Snoozed',
  done: 'Done',
  all: 'All',
};

const VIEW_ICONS: Record<(typeof INBOX_VIEWS)[number], LucideIcon> = {
  open: MailOpen,
  mine: User,
  unread: Mail,
  snoozed: AlarmClock,
  done: CircleCheck,
  all: Layers,
};

/**
 * The Email area's folder pane (ADR-087): the inbox address, its four folders with unread
 * counts, the views, and the area's settings. A column on a wide screen; on a phone the same
 * links as a scrolling row above the list.
 */
export function EmailFolders({
  filters,
  unread,
  mailboxLabel,
  settings,
  phoneRow = true,
}: {
  filters: InboxFilters;
  unread: Record<EmailFolder, number>;
  /** The business's inbox address, or null before one is set up. */
  mailboxLabel: string | null;
  settings: { href: string; label: string }[];
  /** Show the folders as a row on a phone (the list page, not an open email). */
  phoneRow?: boolean;
}) {
  const folder = filters.folder ?? 'customers';
  const view = filters.view ?? 'open';
  const current = { view: filters.view, folder: filters.folder, q: filters.q };
  const item = (active: boolean) =>
    cn(
      'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      active && 'bg-accent font-medium text-foreground',
    );

  return (
    <>
      <nav
        aria-label="Email folders"
        className="hidden min-h-0 flex-col gap-4 overflow-y-auto rounded-xl border bg-card p-2 lg:flex"
      >
        <div className="flex flex-col gap-0.5">
          <p
            className="truncate px-2.5 pt-1 pb-1.5 text-xs font-semibold"
            title={mailboxLabel ?? ''}
          >
            {mailboxLabel ?? 'Email'}
          </p>
          {EMAIL_FOLDERS.map((key) => {
            const Icon = FOLDER_ICONS[key];
            return (
              <Link
                key={key}
                href={withParams('/email', current, {
                  folder: key === 'customers' ? undefined : key,
                })}
                aria-current={folder === key ? 'page' : undefined}
                className={item(folder === key)}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                <span className="flex-1 truncate">{FOLDER_LABELS[key]}</span>
                {unread[key] > 0 && (
                  <span className="text-xs font-semibold text-primary tabular-nums">
                    {unread[key]}
                    <span className="sr-only"> unread</span>
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="px-2.5 pb-1.5 text-xs font-semibold text-muted-foreground">Show</p>
          {INBOX_VIEWS.map((key) => {
            const Icon = VIEW_ICONS[key];
            return (
              <Link
                key={key}
                href={withParams('/email', current, { view: key === 'open' ? undefined : key })}
                aria-current={view === key ? 'page' : undefined}
                className={item(view === key)}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                <span className="flex-1 truncate">{VIEW_LABELS[key]}</span>
              </Link>
            );
          })}
        </div>
        {settings.length > 0 && (
          <div className="mt-auto flex flex-col gap-0.5 border-t pt-2">
            {settings.map((link) => (
              <Link key={link.href} href={link.href} className={item(false)}>
                <Settings2 aria-hidden className="size-4 shrink-0" />
                <span className="flex-1 truncate">{link.label}</span>
              </Link>
            ))}
          </div>
        )}
      </nav>

      <nav
        aria-label="Email folders"
        className={cn('-mx-1 gap-1.5 overflow-x-auto px-1 lg:hidden', phoneRow ? 'flex' : 'hidden')}
      >
        {EMAIL_FOLDERS.map((key) => (
          <Link
            key={key}
            href={withParams('/email', current, { folder: key === 'customers' ? undefined : key })}
            aria-current={folder === key ? 'page' : undefined}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-sm whitespace-nowrap text-muted-foreground',
              folder === key && 'border-primary bg-accent font-medium text-foreground',
            )}
          >
            {FOLDER_LABELS[key]}
            {unread[key] > 0 && <span className="ml-1 tabular-nums">{unread[key]}</span>}
          </Link>
        ))}
      </nav>
    </>
  );
}
