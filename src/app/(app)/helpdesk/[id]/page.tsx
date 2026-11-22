import { ArrowLeft, Lock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CopyField, ReplyBox, TicketControls } from '@/modules/helpdesk/components/helpdesk-tools';
import { SlaBadge } from '@/modules/helpdesk/components/sla-badge';
import { TicketLinks } from '@/modules/helpdesk/components/ticket-links';
import {
  getSlaSettings,
  getTicket,
  getTicketCustomer,
  helpdeskAssignees,
} from '@/modules/helpdesk/queries';
import { PRIORITY_LABELS, STATUS_LABELS } from '@/modules/helpdesk/schemas';
import { firstResponseTarget, resolutionTarget, targetProps } from '@/modules/helpdesk/sla';
import { articleUrl, articleViewsForContact } from '@/modules/kb/queries';
import { PLATFORM_LABELS } from '@/modules/social/format';
import { getConversation } from '@/modules/social/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';
import { serverEnv } from '@/server/env';

export const metadata: Metadata = { title: 'Ticket' };

export default async function TicketPage({ params }: PageProps<'/helpdesk/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'tickets.work');
  const parsed = z.object({ id: z.uuid() }).safeParse(await params);
  const ticket = parsed.success ? await getTicket(ctx, parsed.data.id) : null;
  if (!ticket) notFound();
  const [people, customer, sla, conversation, articleReads] = await Promise.all([
    helpdeskAssignees(ctx),
    getTicketCustomer(ctx, ticket),
    getSlaSettings(ctx),
    ticket.conversationId && hasPermission(ctx, 'social.view')
      ? getConversation(ctx, ticket.conversationId)
      : Promise.resolve(null),
    ticket.contactId ? articleViewsForContact(ctx, ticket.contactId, 5) : Promise.resolve([]),
  ]);
  const customerLink = `${serverEnv().APP_URL}/support/ticket/${ticket.publicToken}`;
  const channel = conversation ? PLATFORM_LABELS[conversation.platform] : null;
  const now = new Date();
  const serverNow = now.toISOString();
  const first = firstResponseTarget(ticket);
  const resolve = resolutionTarget(ticket);
  const labels = ctx.tenant.labels;
  // One thread: the ticket's own messages and notes, and the channel conversation it follows.
  type Item = {
    id: string;
    at: Date;
    author: string;
    kind: 'customer' | 'reply' | 'note';
    body: string;
    where: string | null;
  };
  const items: Item[] = [
    ...ticket.messages.map((message, index): Item => ({
      id: message.id,
      at: message.createdAt,
      author: message.authorName,
      kind: message.isInternal
        ? 'note'
        : (index === 0 && ticket.source !== 'conversation') || message.authorUserId === null
          ? 'customer'
          : 'reply',
      body: message.body,
      where: null,
    })),
    ...(conversation?.messages ?? []).map((message): Item => ({
      id: `channel-${message.id}`,
      at: message.sentAt,
      author:
        message.direction === 'inbound'
          ? ticket.requesterName
          : (message.sentByName ?? `${channel} app`),
      kind:
        message.direction === 'inbound'
          ? 'customer'
          : message.direction === 'note'
            ? 'note'
            : 'reply',
      body: message.body ?? (message.attachments.length > 0 ? 'A photo or file' : ''),
      where: channel,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const hoursText = sla.useBusinessHours
    ? `Counted in business hours (${sla.timezone})${sla.skipPublicHolidays ? ', skipping public holidays' : ''}.`
    : 'Counted around the clock.';

  return (
    <div className="flex w-full max-w-5xl flex-col gap-5">
      <Link
        href="/helpdesk"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> All tickets
      </Link>
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground tabular-nums">
          Ticket #{ticket.number} ·{' '}
          {ticket.source === 'web_form'
            ? 'from the contact form'
            : ticket.source === 'conversation'
              ? `from ${channel ? `a ${channel}` : 'an inbox'} conversation`
              : 'logged by your team'}{' '}
          · {formatDateTime(ctx, ticket.createdAt)}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{ticket.subject}</h1>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{STATUS_LABELS[ticket.status]}</Badge>
          <Badge variant="secondary">{PRIORITY_LABELS[ticket.priority]} priority</Badge>
          <SlaBadge target={targetProps(first)} serverNow={serverNow} prefix="First reply" />
          <SlaBadge target={targetProps(resolve)} serverNow={serverNow} prefix="Resolution" />
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_17rem]">
        <div className="flex min-w-0 flex-col gap-3">
          {ticket.conversationId && !conversation && (
            <p className="rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">
              This ticket follows an inbox conversation you cannot open.
            </p>
          )}
          <ol className="flex flex-col gap-3">
            {items.map((item) => (
              <li
                key={item.id}
                className={cn(
                  'rounded-xl border bg-card p-4',
                  item.kind === 'note' && 'border-warning-border bg-warning/40',
                  item.kind === 'reply' && 'border-primary/30 bg-accent',
                )}
              >
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {item.kind === 'note' && <Lock aria-hidden className="size-3" />}
                  <span className="font-medium text-foreground" data-sensitive>
                    {item.author}
                  </span>
                  {item.kind === 'note'
                    ? '· private note'
                    : item.kind === 'customer'
                      ? '· customer'
                      : '· reply'}
                  {item.where && <span>· on {item.where}</span>}
                  <span>· {formatDateTime(ctx, item.at)}</span>
                </p>
                <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap" data-sensitive>
                  {item.body}
                </p>
              </li>
            ))}
          </ol>
          {conversation && (
            <Link
              href={`/social/${conversation.conversation.id}`}
              className="w-fit text-sm text-primary underline-offset-4 hover:underline"
            >
              Open the conversation in the inbox
            </Link>
          )}
          <ReplyBox
            ticketId={ticket.id}
            customerLink={customerLink}
            channel={channel}
            articles={ctx.tenant.features.includes('knowledge_base')}
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
            {!ticket.conversationId && (
              <>
                <p className="mt-1 text-xs text-muted-foreground">
                  Their page to follow this ticket:
                </p>
                <CopyField value={customerLink} label="Customer's ticket page" />
              </>
            )}
            <div className="mt-2 border-t pt-3">
              <TicketLinks
                ticketId={ticket.id}
                organization={customer.organization}
                canPickOrganization={hasPermission(ctx, 'organizations.view')}
                linked={customer.linked}
                candidates={customer.candidates}
                canLinkOpportunities={hasPermission(ctx, 'opportunities.view')}
                labels={{
                  organization: labels.organization.singular,
                  opportunity: labels.opportunity.singular,
                  opportunities: labels.opportunity.plural,
                }}
              />
            </div>
          </section>
          {articleReads.length > 0 && (
            <section className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm">
              <h2 className="font-medium">Help articles they read</h2>
              <ul className="flex flex-col gap-1.5">
                {articleReads.map((read) => (
                  <li key={read.id} className="flex flex-col">
                    <a
                      href={articleUrl(ctx.tenant.slug, read.slug)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {read.title}
                    </a>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(ctx, read.viewedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
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
            <h2 className="font-medium">Response targets</h2>
            <dl className="mt-2 flex flex-col gap-2 text-muted-foreground">
              <div className="flex flex-col gap-1">
                <dt className="flex items-center justify-between gap-2">
                  First reply
                  <SlaBadge target={targetProps(first)} serverNow={serverNow} />
                </dt>
                <dd>
                  {ticket.firstResponseAt
                    ? `Sent ${formatDateTime(ctx, ticket.firstResponseAt)}`
                    : `Due ${formatDateTime(ctx, ticket.responseDueAt)}`}
                </dd>
              </div>
              {ticket.resolutionDueAt && (
                <div className="flex flex-col gap-1">
                  <dt className="flex items-center justify-between gap-2">
                    Resolution
                    <SlaBadge target={targetProps(resolve)} serverNow={serverNow} />
                  </dt>
                  <dd>
                    {ticket.solvedAt && ['solved', 'closed'].includes(ticket.status)
                      ? `Solved ${formatDateTime(ctx, ticket.solvedAt)}`
                      : ticket.slaPausedAt
                        ? 'Paused while waiting on the customer'
                        : `Due ${formatDateTime(ctx, ticket.resolutionDueAt)}`}
                  </dd>
                </div>
              )}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              {PRIORITY_LABELS[ticket.priority]} priority. {hoursText} The resolution clock stops
              while the ticket is pending the customer.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
