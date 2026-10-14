import 'server-only';

import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { contacts, leadSources, leadStatuses, leadSubSources, users } from '@/db/schema';
import { decodeCursor, encodeCursor, likePattern } from '@/lib/cursor';
import { scopeFilter } from '@/lib/permissions/scope';
import { contactScope } from '@/modules/contacts/access';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { LeadQueueFilters } from './schemas';
import { completeness, readCrmSettings } from './settings';

export const LEAD_PAGE_SIZE = 50;
export const LEAD_VIEWS = ['mine', 'queue', 'pending', 'returned', 'overdue', 'all'] as const;
export type LeadView = (typeof LEAD_VIEWS)[number];

const OPEN_KINDS = ['new', 'working', 'returned', 'pending_acceptance'] as const;
export const owners = alias(users, 'lead_owner');
export const handoverTo = alias(users, 'lead_handover_to');

export type LeadRow = {
  id: string;
  fullName: string;
  companyName: string | null;
  leadType: 'b2b' | 'b2c' | null;
  statusName: string;
  statusKind: string;
  statusColor: string | null;
  sourceName: string | null;
  subSourceName: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  handoverToName: string | null;
  createdAt: Date;
  lastActivityAt: Date | null;
  completeness: number;
  overdue: 'first_contact' | 'acceptance' | null;
};

/** SQL for "breaching an SLA now": no first contact in time, or a handover past its deadline. */
function overdueCondition(firstContactHours: number): SQL {
  return or(
    and(
      isNull(contacts.firstContactedAt),
      inArray(leadStatuses.kind, ['new', 'working', 'returned']),
      sql`coalesce(${contacts.assignedAt}, ${contacts.createdAt}) < now() - make_interval(hours => ${firstContactHours})`,
    ),
    and(eq(leadStatuses.kind, 'pending_acceptance'), lt(contacts.handoverDueAt, sql`now()`)),
  ) as SQL;
}

function viewCondition(
  ctx: TenantContext,
  view: LeadView,
  firstContactHours: number,
): SQL | undefined {
  switch (view) {
    case 'mine':
      return and(
        or(eq(contacts.ownerUserId, ctx.userId), eq(contacts.handoverToUserId, ctx.userId)),
        inArray(leadStatuses.kind, [...OPEN_KINDS]),
      );
    case 'queue':
      return and(
        isNull(contacts.ownerUserId),
        inArray(leadStatuses.kind, ['new', 'working', 'returned']),
      );
    case 'pending':
      return and(eq(leadStatuses.kind, 'pending_acceptance'), isNotNull(contacts.handoverToUserId));
    case 'returned':
      return eq(leadStatuses.kind, 'returned');
    case 'overdue':
      return overdueCondition(firstContactHours);
    case 'all':
      return undefined;
  }
}

export function baseConditions(
  ctx: TenantContext,
  filters: LeadQueueFilters,
  view: LeadView,
): SQL[] {
  const settings = readCrmSettings(ctx.tenant.settings);
  const conditions: (SQL | undefined)[] = [
    eq(contacts.tenantId, ctx.tenantId),
    isNull(contacts.deletedAt),
    isNotNull(contacts.leadStatusId),
    scopeFilter(ctx, 'contacts.view', contacts, contactScope),
    viewCondition(ctx, view, settings.sla.firstContactHours),
  ];
  if (filters.q) {
    conditions.push(
      or(
        ilike(contacts.fullName, likePattern(filters.q)),
        ilike(contacts.email, likePattern(filters.q)),
        ilike(contacts.companyName, likePattern(filters.q)),
      ),
    );
  }
  if (filters.status) conditions.push(eq(contacts.leadStatusId, filters.status));
  if (filters.source) conditions.push(eq(contacts.sourceId, filters.source));
  if (filters.type) conditions.push(eq(contacts.leadType, filters.type));
  if (filters.owner) conditions.push(eq(contacts.ownerUserId, filters.owner));
  return conditions.filter((condition): condition is SQL => condition !== undefined);
}

export async function listLeads(
  ctx: TenantContext,
  filters: LeadQueueFilters,
): Promise<{ items: LeadRow[]; nextCursor: string | null }> {
  requirePermission(ctx, 'contacts.view');
  const settings = readCrmSettings(ctx.tenant.settings);
  const view: LeadView = filters.view ?? 'mine';
  const conditions = baseConditions(ctx, filters, view);
  const cursor = decodeCursor(filters.cursor);
  if (cursor) {
    conditions.push(
      or(
        lt(contacts.createdAt, cursor.createdAt),
        and(eq(contacts.createdAt, cursor.createdAt), lt(contacts.id, cursor.id)),
      ) as SQL,
    );
  }

  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        contact: contacts,
        statusName: leadStatuses.name,
        statusKind: leadStatuses.kind,
        statusColor: leadStatuses.color,
        sourceName: leadSources.name,
        subSourceName: leadSubSources.name,
        ownerName: owners.fullName,
        handoverToName: handoverTo.fullName,
      })
      .from(contacts)
      .innerJoin(
        leadStatuses,
        and(
          eq(leadStatuses.tenantId, contacts.tenantId),
          eq(leadStatuses.id, contacts.leadStatusId),
        ),
      )
      .leftJoin(
        leadSources,
        and(eq(leadSources.tenantId, contacts.tenantId), eq(leadSources.id, contacts.sourceId)),
      )
      .leftJoin(
        leadSubSources,
        and(
          eq(leadSubSources.tenantId, contacts.tenantId),
          eq(leadSubSources.id, contacts.subSourceId),
        ),
      )
      .leftJoin(owners, eq(owners.id, contacts.ownerUserId))
      .leftJoin(handoverTo, eq(handoverTo.id, contacts.handoverToUserId))
      .where(and(...conditions))
      .orderBy(desc(contacts.createdAt), desc(contacts.id))
      .limit(LEAD_PAGE_SIZE + 1),
  );

  const now = Date.now();
  const items = rows.slice(0, LEAD_PAGE_SIZE).map((row): LeadRow => {
    const c = row.contact;
    const firstDue =
      (c.assignedAt ?? c.createdAt).getTime() + settings.sla.firstContactHours * 3_600_000;
    const overdue =
      row.statusKind === 'pending_acceptance' && c.handoverDueAt && c.handoverDueAt.getTime() < now
        ? 'acceptance'
        : !c.firstContactedAt &&
            ['new', 'working', 'returned'].includes(row.statusKind) &&
            firstDue < now
          ? 'first_contact'
          : null;
    return {
      id: c.id,
      fullName: c.fullName ?? c.firstName,
      companyName: c.companyName,
      leadType: c.leadType,
      statusName: row.statusName,
      statusKind: row.statusKind,
      statusColor: row.statusColor,
      sourceName: row.sourceName,
      subSourceName: row.subSourceName,
      ownerUserId: c.ownerUserId,
      ownerName: row.ownerName,
      handoverToName: row.handoverToName,
      createdAt: c.createdAt,
      lastActivityAt: c.lastActivityAt,
      completeness: completeness(
        settings.completenessFields,
        c as unknown as Record<string, unknown>,
      ),
      overdue,
    };
  });
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > LEAD_PAGE_SIZE && last ? encodeCursor(last) : null,
  };
}

/** How many leads each view holds, under the same search and filters. */
export async function countLeadViews(
  ctx: TenantContext,
  filters: LeadQueueFilters,
): Promise<Record<LeadView, number>> {
  requirePermission(ctx, 'contacts.view');
  const counts = await withRls(ctx, async (tx) =>
    Promise.all(
      LEAD_VIEWS.map(async (view) => {
        const [row] = await tx
          .select({ total: count() })
          .from(contacts)
          .innerJoin(
            leadStatuses,
            and(
              eq(leadStatuses.tenantId, contacts.tenantId),
              eq(leadStatuses.id, contacts.leadStatusId),
            ),
          )
          .where(and(...baseConditions(ctx, { ...filters, view }, view)));
        return [view, row?.total ?? 0] as const;
      }),
    ),
  );
  return Object.fromEntries(counts) as Record<LeadView, number>;
}
