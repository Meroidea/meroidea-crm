import { SquarePen } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';

import { EmailFolders } from '@/modules/social/components/email-folders';
import type { EmailFolder, InboxFilters } from '@/modules/social/schemas';

/**
 * The Email area's three panes (ADR-087): folders, the message list and the reading pane, filling
 * the screen's height like a desktop mail client. On a phone the list and an open email each
 * take the whole screen, so `reading` says which one this page is.
 */
export function EmailWorkspace({
  filters,
  unread,
  mailboxLabel,
  settings,
  actions,
  list,
  reading = false,
  canCompose = false,
  drafts = null,
  inDrafts = false,
  children,
}: {
  filters: InboxFilters;
  unread: Record<EmailFolder, number>;
  mailboxLabel: string | null;
  settings: { href: string; label: string }[];
  actions?: ReactNode;
  list: ReactNode;
  /** An email is open: on a phone show it instead of the list. */
  reading?: boolean;
  /** The person may write a new email (ADR-090). */
  canCompose?: boolean;
  /** How many drafts the person has (ADR-091), or null. */
  drafts?: number | null;
  /** The Drafts list is open. */
  inDrafts?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full max-w-screen-2xl flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Email</h1>
        <div className="flex items-center gap-2">
          {actions}
          {canCompose && (
            <Button asChild size="sm" className="lg:hidden">
              <Link href="/email/compose">
                <SquarePen aria-hidden /> Compose
              </Link>
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-3 lg:h-[calc(100dvh-9rem)] lg:min-h-[32rem] lg:grid-cols-[13rem_20rem_1fr] xl:grid-cols-[14rem_24rem_1fr]">
        <EmailFolders
          filters={filters}
          unread={unread}
          mailboxLabel={mailboxLabel}
          settings={settings}
          phoneRow={!reading}
          canCompose={canCompose}
          drafts={drafts}
          inDrafts={inDrafts}
        />
        <div
          className={
            reading ? 'hidden min-h-0 min-w-0 lg:flex lg:flex-col' : 'flex min-h-0 min-w-0 flex-col'
          }
        >
          {list}
        </div>
        <div
          className={
            reading ? 'flex min-h-0 min-w-0 flex-col' : 'hidden min-h-0 min-w-0 lg:flex lg:flex-col'
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}
