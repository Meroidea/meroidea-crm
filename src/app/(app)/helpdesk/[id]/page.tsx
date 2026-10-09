import { ArrowLeft, Lock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CopyField, ReplyBox, TicketControls } from '@/modules/helpdesk/components/helpdesk-tools';
import { getTicket } from '@/modules/helpdesk/queries';
import { PRIORITY_LABELS, RESPONSE_HOURS, STATUS_LABELS } from '@/modules/helpdesk/schemas';
import { listActiveMembers } from '@/modules/members/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';
import { serverEnv } from '@/server/env';

export const metadata: Metadata = { title: 'Ticket' };

export default async function TicketPage({ params }: PageProps<'/helpdesk/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'tickets.work');
  const parsed = z.object({ id: z.uuid() }).safeParse(await params);
  const ticket = parsed.success ? await getTicket(ctx, parsed.data.id) : null;
  if (!ticket) notFound();
  const people = await listActiveMembers(ctx);
  const customerLink = `${serverEnv().APP_URL}/support/ticket/${ticket.publicToken}`;
  const active = ['open', 'pending', 'on_hold'].includes(ticket.status);
  const overdue = active && !ticket.firstResponseAt && ticket.responseDueAt < new Date();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <Link
        href="/helpdesk"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> All tickets
      </Link>
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground tabular-nums">
          Ticket #{ticket.number} ·{' '}
          {ticket.source === 'web_form' ? 'from the contact form' : 'logged by your team'} ·{' '}
          {formatDateTime(ctx, ticket.createdAt)}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{ticket.subject}</h1>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{STATUS_LABELS[ticket.status]}</Badge>
          <Badge variant="secondary">{PRIORITY_LABELS[ticket.priority]} priority</Badge>
          {overdue && <Badge variant="destructive">First reply overdue</Badge>}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_17rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <ol className="flex flex-col gap-3">
            {ticket.messages.map((message, index) => {
              const fromCustomer = index === 0 || message.authorUserId === null;
              return (
                <li
                  key={message.id}
                  className={cn(
                    'rounded-xl border bg-card p-4',
                    message.isInternal && 'border-warning-border bg-warning/40',
                    !fromCustomer && !message.isInternal && 'border-primary/30 bg-accent',
                  )}
                >
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {message.isInternal && <Lock aria-hidden className="size-3" />}
                    <span className="font-medium text-foreground" data-sensitive>
                      {message.authorName}
                    </span>
                    {message.isInternal
                      ? '· private note'
                      : fromCustomer
                        ? '· customer'
                        : '· reply'}
                    <span>· {formatDateTime(ctx, message.createdAt)}</span>
                  </p>
                  <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{message.body}</p>
                </li>
              );
            })}
          </ol>
          <ReplyBox
            ticketId={ticket.id}
            hasEmail={Boolean(ticket.requesterEmail)}
            customerLink={customerLink}
          />
        </div>

        <aside className="flex flex-col gap-4">
          <section className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm">
            <h2 className="font-medium">Customer</h2>
            <p data-sensitive>{ticket.requesterName}</p>
            {ticket.requesterEmail && (
              <a
                href={`mailto:${ticket.requesterEmail}`}
                className="truncate underline underline-offset-4"
                data-sensitive
              >
                {ticket.requesterEmail}
              </a>
            )}
            {ticket.contactId && hasPermission(ctx, 'contacts.view') && (
              <Link
                href={`/contacts/${ticket.contactId}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                Open their record
              </Link>
            )}
            <p className="mt-1 text-xs text-muted-foreground">Their page to follow this ticket:</p>
            <CopyField value={customerLink} label="Customer's ticket page" />
          </section>
          <section className="rounded-xl border bg-card p-4">
            <TicketControls
              key={`${ticket.status}-${ticket.priority}-${ticket.assigneeUserId}-${ticket.category}`}
              ticket={{
                id: ticket.id,
                status: ticket.status,
                priority: ticket.priority,
                category: ticket.category,
                assigneeUserId: ticket.assigneeUserId,
              }}
              people={people}
              canDelete={hasPermission(ctx, 'tickets.manage')}
            />
          </section>
          <section className="rounded-xl border bg-card p-4 text-sm">
            <h2 className="font-medium">Response target</h2>
            <dl className="mt-2 flex flex-col gap-1.5 text-muted-foreground">
              <div className="flex justify-between gap-2">
                <dt>First reply due</dt>
                <dd className={cn('text-right', overdue && 'font-medium text-destructive-text')}>
                  {formatDateTime(ctx, ticket.responseDueAt)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>First reply sent</dt>
                <dd className="text-right">
                  {ticket.firstResponseAt ? formatDateTime(ctx, ticket.firstResponseAt) : 'Not yet'}
                </dd>
              </div>
              {ticket.solvedAt && (
                <div className="flex justify-between gap-2">
                  <dt>Solved</dt>
                  <dd className="text-right">{formatDateTime(ctx, ticket.solvedAt)}</dd>
                </div>
              )}
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              {PRIORITY_LABELS[ticket.priority]} priority aims for a first reply within{' '}
              {RESPONSE_HOURS[ticket.priority]}{' '}
              {RESPONSE_HOURS[ticket.priority] === 1 ? 'hour' : 'hours'} of the ticket being
              created.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
