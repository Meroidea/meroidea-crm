import 'server-only';

import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';

import { helpdeskForms, ticketMessages, tickets, users } from '@/db/schema';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { Priority, Queue, TicketStatus } from './schemas';

const ACTIVE: TicketStatus[] = ['open', 'pending', 'on_hold'];

export type TicketRow = {
  id: string;
  number: number;
  subject: string;
  requesterName: string;
  requesterEmail: string | null;
  contactId: string | null;
  category: string | null;
  priority: Priority;
  status: TicketStatus;
  assigneeUserId: string | null;
  assigneeName: string | null;
  source: 'web_form' | 'manual';
  publicToken: string;
  responseDueAt: Date;
  firstResponseAt: Date | null;
  solvedAt: Date | null;
  lastActivityAt: Date;
  createdAt: Date;
};

const columns = {
  id: tickets.id,
  number: tickets.number,
  subject: tickets.subject,
  requesterName: tickets.requesterName,
  requesterEmail: tickets.requesterEmail,
  contactId: tickets.contactId,
  category: tickets.category,
  priority: tickets.priority,
  status: tickets.status,
  assigneeUserId: tickets.assigneeUserId,
  assigneeName: users.fullName,
  source: tickets.source,
  publicToken: tickets.publicToken,
  responseDueAt: tickets.responseDueAt,
  firstResponseAt: tickets.firstResponseAt,
  solvedAt: tickets.solvedAt,
  lastActivityAt: tickets.lastActivityAt,
  createdAt: tickets.createdAt,
};

function queueFilter(ctx: TenantContext, queue: Queue) {
  switch (queue) {
    case 'open':
      return inArray(tickets.status, ACTIVE);
    case 'mine':
      return and(inArray(tickets.status, ACTIVE), eq(tickets.assigneeUserId, ctx.userId));
    case 'unassigned':
      return and(inArray(tickets.status, ACTIVE), isNull(tickets.assigneeUserId));
    case 'solved':
      return inArray(tickets.status, ['solved', 'closed']);
    case 'all':
      return undefined;
  }
}

/** Urgent first, then whichever has waited longest for someone to write. */
const QUEUE_ORDER = [
  sql`case ${tickets.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`,
  asc(tickets.lastActivityAt),
];

export async function listTickets(
  ctx: TenantContext,
  options: { queue: Queue; q?: string | undefined },
): Promise<TicketRow[]> {
  requirePermission(ctx, 'tickets.work');
  const search = options.q ? `%${options.q.replace(/[%_\\]/g, '\\$&')}%` : null;
  const number =
    options.q && /^#?\d{1,9}$/.test(options.q) ? Number(options.q.replace('#', '')) : null;
  const rows = await withRls(ctx, (tx) =>
    tx
      .select(columns)
      .from(tickets)
      .leftJoin(users, eq(users.id, tickets.assigneeUserId))
      .where(
        and(
          eq(tickets.tenantId, ctx.tenantId),
          isNull(tickets.deletedAt),
          queueFilter(ctx, options.queue),
          search
            ? or(
                ilike(tickets.subject, search),
                ilike(tickets.requesterName, search),
                ilike(tickets.requesterEmail, search),
                number === null ? undefined : eq(tickets.number, number),
              )
            : undefined,
        ),
      )
      .orderBy(...(options.queue === 'solved' ? [desc(tickets.lastActivityAt)] : QUEUE_ORDER))
      .limit(200),
  );
  return rows as TicketRow[];
}

export async function getTicketCounts(ctx: TenantContext) {
  requirePermission(ctx, 'tickets.work');
  const active = sql`${tickets.status} in ('open', 'pending', 'on_hold')`;
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({
        open: sql<number>`count(*) filter (where ${active})::int`,
        mine: sql<number>`count(*) filter (where ${active} and ${tickets.assigneeUserId} = ${ctx.userId})::int`,
        unassigned: sql<number>`count(*) filter (where ${active} and ${tickets.assigneeUserId} is null)::int`,
        overdue: sql<number>`count(*) filter (where ${active} and ${tickets.firstResponseAt} is null
          and ${tickets.responseDueAt} < now())::int`,
      })
      .from(tickets)
      .where(and(eq(tickets.tenantId, ctx.tenantId), isNull(tickets.deletedAt))),
  );
  return row ?? { open: 0, mine: 0, unassigned: 0, overdue: 0 };
}

export async function getTicket(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'tickets.work');
  return withRls(ctx, async (tx) => {
    const [ticket] = await tx
      .select(columns)
      .from(tickets)
      .leftJoin(users, eq(users.id, tickets.assigneeUserId))
      .where(and(eq(tickets.tenantId, ctx.tenantId), eq(tickets.id, id), isNull(tickets.deletedAt)))
      .limit(1);
    if (!ticket) return null;
    const messages = await tx
      .select({
        id: ticketMessages.id,
        authorUserId: ticketMessages.authorUserId,
        authorName: ticketMessages.authorName,
        body: ticketMessages.body,
        isInternal: ticketMessages.isInternal,
        createdAt: ticketMessages.createdAt,
      })
      .from(ticketMessages)
      .where(and(eq(ticketMessages.tenantId, ctx.tenantId), eq(ticketMessages.ticketId, id)))
      .orderBy(asc(ticketMessages.createdAt));
    return { ...(ticket as TicketRow), messages };
  });
}

export async function getHelpdeskForm(ctx: TenantContext) {
  requirePermission(ctx, 'tickets.work');
  const [form] = await withRls(ctx, (tx) =>
    tx
      .select({ publicToken: helpdeskForms.publicToken, isOpen: helpdeskForms.isOpen })
      .from(helpdeskForms)
      .where(eq(helpdeskForms.tenantId, ctx.tenantId))
      .limit(1),
  );
  return form ?? null;
}
