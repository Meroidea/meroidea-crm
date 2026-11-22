import 'server-only';

import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';

import {
  businessHours,
  helpdeskForms,
  opportunities,
  organizations,
  slaPolicies,
  slaTargets,
  ticketMessages,
  ticketOpportunities,
  tickets,
  users,
} from '@/db/schema';
import { scopeFilter } from '@/lib/permissions/scope';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';
import { listActiveMembers, listMemberIdsWithPermission } from '@/modules/members/queries';

import {
  PRIORITIES,
  RESPONSE_HOURS,
  type Priority,
  type Queue,
  type TicketStatus,
} from './schemas';

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
  source: 'web_form' | 'manual' | 'conversation';
  publicToken: string;
  responseDueAt: Date;
  firstResponseAt: Date | null;
  solvedAt: Date | null;
  organizationId: string | null;
  conversationId: string | null;
  slaPolicyId: string | null;
  resolutionDueAt: Date | null;
  firstResponseAtRiskAt: Date | null;
  resolutionAtRiskAt: Date | null;
  slaPausedAt: Date | null;
  firstResponseBreachedAt: Date | null;
  resolutionBreachedAt: Date | null;
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
  organizationId: tickets.organizationId,
  conversationId: tickets.conversationId,
  slaPolicyId: tickets.slaPolicyId,
  resolutionDueAt: tickets.resolutionDueAt,
  firstResponseAtRiskAt: tickets.firstResponseAtRiskAt,
  resolutionAtRiskAt: tickets.resolutionAtRiskAt,
  slaPausedAt: tickets.slaPausedAt,
  firstResponseBreachedAt: tickets.firstResponseBreachedAt,
  resolutionBreachedAt: tickets.resolutionBreachedAt,
  lastActivityAt: tickets.lastActivityAt,
  createdAt: tickets.createdAt,
};

/** A target still running whose at-risk time has come (breached ones included). */
const atRisk = sql`((${tickets.firstResponseAt} is null and ${tickets.firstResponseAtRiskAt} <= now())
  or (${tickets.slaPausedAt} is null and ${tickets.resolutionAtRiskAt} <= now()))`;
/** A target still running whose due time has passed. */
const breached = sql`((${tickets.firstResponseAt} is null and ${tickets.responseDueAt} < now())
  or (${tickets.slaPausedAt} is null and ${tickets.resolutionDueAt} < now()))`;
/** The next running target's due time: what the working queue is sorted by. */
const nextDue = sql`least(
  case when ${tickets.firstResponseAt} is null then ${tickets.responseDueAt} end,
  case when ${tickets.slaPausedAt} is null then ${tickets.resolutionDueAt} end)`;

function queueFilter(ctx: TenantContext, queue: Queue) {
  switch (queue) {
    case 'open':
      return inArray(tickets.status, ACTIVE);
    case 'mine':
      return and(inArray(tickets.status, ACTIVE), eq(tickets.assigneeUserId, ctx.userId));
    case 'unassigned':
      return and(inArray(tickets.status, ACTIVE), isNull(tickets.assigneeUserId));
    case 'at_risk':
      return and(inArray(tickets.status, ACTIVE), atRisk);
    case 'solved':
      return inArray(tickets.status, ['solved', 'closed']);
    case 'all':
      return undefined;
  }
}

/**
 * Whatever is due soonest first (ADR-069); tickets with no running target (all paused) after,
 * urgent first, then whichever has waited longest.
 */
const QUEUE_ORDER = [
  sql`${nextDue} asc nulls last`,
  sql`case ${tickets.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`,
  asc(tickets.lastActivityAt),
];

/** The most a ticket list shows; the page says so when there are more. */
export const TICKET_LIST_LIMIT = 200;

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
          // A search looks through every ticket, not just the queue it was typed in: someone
          // looking up "#123" or a customer's name wants it wherever it now sits.
          search ? undefined : queueFilter(ctx, options.queue),
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
      // Working queues put the most urgent and longest-waiting first; everything else (all,
      // solved, a search) the most recent first, so the cap never hides today's tickets.
      .orderBy(
        ...(search || options.queue === 'solved' || options.queue === 'all'
          ? [desc(tickets.lastActivityAt)]
          : QUEUE_ORDER),
      )
      .limit(TICKET_LIST_LIMIT),
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
        atRisk: sql<number>`count(*) filter (where ${active} and ${atRisk})::int`,
        overdue: sql<number>`count(*) filter (where ${active} and ${breached})::int`,
      })
      .from(tickets)
      .where(and(eq(tickets.tenantId, ctx.tenantId), isNull(tickets.deletedAt))),
  );
  return row ?? { open: 0, mine: 0, unassigned: 0, atRisk: 0, overdue: 0 };
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

/** Who a ticket can be given to: the business's own people whose role can work tickets. */
export async function helpdeskAssignees(ctx: TenantContext) {
  requirePermission(ctx, 'tickets.work');
  const [members, workers] = await Promise.all([
    listActiveMembers(ctx),
    listMemberIdsWithPermission(ctx, 'tickets.work'),
  ]);
  return members.filter((member) => workers.includes(member.userId));
}

export type TicketCustomer = {
  organization: { id: string; name: string } | null;
  /** Linked opportunities the person may see. */
  linked: { id: string; name: string; status: string }[];
  /** The contact's other open opportunities the person may see, to link. */
  candidates: { id: string; name: string }[];
};

/**
 * The organization and opportunities around a ticket (ADR-069), each named only within what the
 * person may see (organizations.view, opportunities.view and its record scope).
 */
export async function getTicketCustomer(
  ctx: TenantContext,
  ticket: { id: string; contactId: string | null; organizationId: string | null },
): Promise<TicketCustomer> {
  requirePermission(ctx, 'tickets.work');
  return withRls(ctx, async (tx) => {
    const [organization] =
      ticket.organizationId && hasPermission(ctx, 'organizations.view')
        ? await tx
            .select({ id: organizations.id, name: organizations.name })
            .from(organizations)
            .where(
              and(
                eq(organizations.tenantId, ctx.tenantId),
                eq(organizations.id, ticket.organizationId),
                isNull(organizations.deletedAt),
              ),
            )
            .limit(1)
        : [];
    if (!hasPermission(ctx, 'opportunities.view')) {
      return { organization: organization ?? null, linked: [], candidates: [] };
    }
    const visible = and(
      eq(opportunities.tenantId, ctx.tenantId),
      isNull(opportunities.deletedAt),
      scopeFilter(ctx, 'opportunities.view', opportunities),
    );
    const linked = await tx
      .select({ id: opportunities.id, name: opportunities.name, status: opportunities.status })
      .from(ticketOpportunities)
      .innerJoin(
        opportunities,
        and(
          eq(opportunities.tenantId, ticketOpportunities.tenantId),
          eq(opportunities.id, ticketOpportunities.opportunityId),
        ),
      )
      .where(
        and(
          eq(ticketOpportunities.tenantId, ctx.tenantId),
          eq(ticketOpportunities.ticketId, ticket.id),
          visible,
        ),
      )
      .orderBy(asc(opportunities.name));
    const candidates = ticket.contactId
      ? await tx
          .select({ id: opportunities.id, name: opportunities.name })
          .from(opportunities)
          .where(
            and(
              visible,
              eq(opportunities.contactId, ticket.contactId),
              eq(opportunities.status, 'open'),
            ),
          )
          .orderBy(asc(opportunities.name))
          .limit(50)
      : [];
    const linkedIds = new Set(linked.map((item) => item.id));
    return {
      organization: organization ?? null,
      linked,
      candidates: candidates.filter((item) => !linkedIds.has(item.id)),
    };
  });
}

/** The tickets that follow an inbox conversation, newest first (ADR-069). */
export async function ticketsForConversation(
  ctx: TenantContext,
  conversationId: string,
): Promise<{ id: string; number: number; status: TicketStatus }[]> {
  if (!hasPermission(ctx, 'tickets.work')) return [];
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({ id: tickets.id, number: tickets.number, status: tickets.status })
      .from(tickets)
      .where(
        and(
          eq(tickets.tenantId, ctx.tenantId),
          eq(tickets.conversationId, conversationId),
          isNull(tickets.deletedAt),
        ),
      )
      .orderBy(desc(tickets.createdAt))
      .limit(10),
  );
  return rows as { id: string; number: number; status: TicketStatus }[];
}

export type SlaSettings = {
  policyName: string;
  atRiskPercent: number;
  escalateToUserId: string | null;
  useBusinessHours: boolean;
  timezone: string;
  skipPublicHolidays: boolean;
  weekly: { day: number; opens: string; closes: string }[];
  targets: Record<Priority, { firstResponseHours: number; resolutionHours: number }>;
};

/** The business's response targets as the settings form shows them (ADR-069). */
export async function getSlaSettings(ctx: TenantContext): Promise<SlaSettings> {
  requirePermission(ctx, 'tickets.work');
  return withRls(ctx, async (tx) => {
    const [policy] = await tx
      .select({
        id: slaPolicies.id,
        name: slaPolicies.name,
        atRiskPercent: slaPolicies.atRiskPercent,
        escalateToUserId: slaPolicies.escalateToUserId,
        businessHoursId: slaPolicies.businessHoursId,
      })
      .from(slaPolicies)
      .where(and(eq(slaPolicies.tenantId, ctx.tenantId), eq(slaPolicies.isDefault, true)))
      .limit(1);
    const targets = policy
      ? await tx
          .select()
          .from(slaTargets)
          .where(and(eq(slaTargets.tenantId, ctx.tenantId), eq(slaTargets.policyId, policy.id)))
      : [];
    // The hours the policy counts in; else the ones last saved here, kept while switched off.
    const [hours] = await tx
      .select()
      .from(businessHours)
      .where(
        and(
          eq(businessHours.tenantId, ctx.tenantId),
          policy?.businessHoursId ? eq(businessHours.id, policy.businessHoursId) : undefined,
        ),
      )
      .orderBy(desc(businessHours.updatedAt))
      .limit(1);
    const byPriority = Object.fromEntries(
      PRIORITIES.map((priority) => {
        const target = targets.find((row) => row.priority === priority);
        return [
          priority,
          target
            ? {
                firstResponseHours: target.firstResponseMinutes / 60,
                resolutionHours: target.resolutionMinutes / 60,
              }
            : {
                firstResponseHours: RESPONSE_HOURS[priority],
                resolutionHours: RESPONSE_HOURS[priority] * 3,
              },
        ];
      }),
    ) as SlaSettings['targets'];
    // Monday to Friday, 9 to 5, as a starting point for a business that has not set hours yet.
    const weekdays = [1, 2, 3, 4, 5].map((day) => ({ day, opens: '09:00', closes: '17:00' }));
    return {
      policyName: policy?.name ?? 'Standard',
      atRiskPercent: policy?.atRiskPercent ?? 75,
      escalateToUserId: policy?.escalateToUserId ?? null,
      useBusinessHours: Boolean(policy?.businessHoursId),
      timezone: hours?.timezone ?? ctx.tenant.timezone,
      skipPublicHolidays: hours?.skipPublicHolidays ?? true,
      weekly: (hours?.weekly as SlaSettings['weekly'] | undefined) ?? weekdays,
      targets: byPriority,
    };
  });
}
