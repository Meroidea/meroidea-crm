import { LifeBuoy } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { NewTicketButton, PublicFormCard } from '@/modules/helpdesk/components/helpdesk-tools';
import { getHelpdeskForm, getTicketCounts, listTickets } from '@/modules/helpdesk/queries';
import {
  helpdeskParamsSchema,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Queue,
} from '@/modules/helpdesk/schemas';
import { listActiveMembers } from '@/modules/members/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';
import { serverEnv } from '@/server/env';

export const metadata: Metadata = { title: 'Helpdesk' };

const PRIORITY_VARIANT = {
  urgent: 'destructive',
  high: 'default',
  normal: 'secondary',
  low: 'outline',
} as const;

export default async function HelpdeskPage({ searchParams }: PageProps<'/helpdesk'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'tickets.work');
  const params = helpdeskParamsSchema.parse(await searchParams);
  const queue: Queue = params.queue ?? 'open';
  const [tickets, counts, form, people] = await Promise.all([
    listTickets(ctx, { queue, q: params.q }),
    getTicketCounts(ctx),
    getHelpdeskForm(ctx),
    listActiveMembers(ctx),
  ]);
  const now = new Date();

  const queues: [Queue, string, number | null][] = [
    ['open', 'Open', counts.open],
    ['mine', 'Mine', counts.mine],
    ['unassigned', 'Unassigned', counts.unassigned],
    ['solved', 'Solved', null],
    ['all', 'All', null],
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Helpdesk"
        description="Customer requests in one queue: who has them, how urgent they are, and what was said."
        actions={<NewTicketButton people={people} />}
      />

      {counts.overdue > 0 && (
        <p className="rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-text">
          <span className="font-semibold">{counts.overdue}</span>{' '}
          {counts.overdue === 1 ? 'ticket is' : 'tickets are'} past the time a first reply was due.
        </p>
      )}

      <PublicFormCard
        url={form ? `${serverEnv().APP_URL}/support/${form.publicToken}` : null}
        isOpen={form?.isOpen ?? false}
        canManage={hasPermission(ctx, 'tickets.manage')}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Queues" className="flex flex-wrap gap-1">
          {queues.map(([key, label, count]) => (
            <Link
              key={key}
              href={key === 'open' ? '/helpdesk' : `/helpdesk?queue=${key}`}
              aria-current={queue === key ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground',
                queue === key && 'bg-accent font-medium text-foreground',
              )}
            >
              {label}
              {count !== null && <span className="ml-1.5 tabular-nums">{count}</span>}
            </Link>
          ))}
        </nav>
        <form action="/helpdesk" className="flex gap-2">
          {queue !== 'open' && <input type="hidden" name="queue" value={queue} />}
          <input
            type="search"
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Search subject, customer or #number"
            aria-label="Search tickets"
            className="h-8 w-64 rounded-md border bg-background px-3 text-sm"
          />
        </form>
      </div>

      {tickets.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={LifeBuoy}
            title={params.q ? 'No tickets match that search' : 'Nothing in this queue'}
            description="New requests appear here from the public contact form, or when you log one yourself."
          />
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {tickets.map((ticket) => {
            const active = ['open', 'pending', 'on_hold'].includes(ticket.status);
            const overdue = active && !ticket.firstResponseAt && ticket.responseDueAt < now;
            return (
              <li key={ticket.id}>
                <Link
                  href={`/helpdesk/${ticket.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/50"
                >
                  <span className="w-14 shrink-0 text-sm text-muted-foreground tabular-nums">
                    #{ticket.number}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{ticket.subject}</p>
                    <p className="truncate text-sm text-muted-foreground" data-sensitive>
                      {ticket.requesterName}
                      {ticket.category && ` · ${ticket.category}`} · last activity{' '}
                      {formatRelative(ticket.lastActivityAt, now)}
                    </p>
                  </div>
                  {overdue && <Badge variant="destructive">Reply overdue</Badge>}
                  <Badge variant={PRIORITY_VARIANT[ticket.priority]}>
                    {PRIORITY_LABELS[ticket.priority]}
                  </Badge>
                  <Badge variant="outline">{STATUS_LABELS[ticket.status]}</Badge>
                  <span className="w-28 truncate text-right text-sm text-muted-foreground">
                    {ticket.assigneeName ?? 'Unassigned'}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
