import 'server-only';

import { and, asc, count, desc, eq, gte, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  contacts,
  leadSources,
  lostReasons,
  opportunities,
  organizations,
  partners,
  pipelineStages,
  stageHistory,
  users,
} from '@/db/schema';
import { decodeCursor, encodeCursor, likePattern } from '@/lib/cursor';
import { daysBetween } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { assertCanAccess, canAccess, scopeFilter } from '@/lib/permissions/scope';
import { loadPipelineConfig, type PipelineConfig } from '@/modules/pipelines/queries';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { OpportunityListFilters } from './schemas';
import type { BoardColumn, OpportunityDetail, OpportunityRow, OpportunityStatus } from './types';

export const OPPORTUNITY_PAGE_SIZE = 50;

const SCOPE_RANK = { own: 1, team: 2, all: 3 } as const;

/**
 * Column and dashboard totals sum every opportunity the viewer can see, so they are shown only
 * when revenue.view reaches at least as far as opportunities.view — never a total that includes
 * amounts the viewer may not see one by one.
 */
export function revenueCoversView(ctx: TenantContext): boolean {
  const revenue = ctx.grants.get('revenue.view');
  const view = ctx.grants.get('opportunities.view');
  if (revenue === undefined || view === undefined) return false;
  const rank = (grant: typeof revenue) => (grant === true ? 3 : SCOPE_RANK[grant]);
  return rank(revenue) >= rank(view);
}
const BOARD_COLUMN_LIMIT = 50;
const CLOSED_WINDOW_DAYS = 30;

const ownerUsers = alias(users, 'owner_users');

const rowColumns = {
  id: opportunities.id,
  name: opportunities.name,
  contactId: opportunities.contactId,
  contactName: contacts.fullName,
  stageId: opportunities.stageId,
  stageName: pipelineStages.name,
  stageColor: pipelineStages.color,
  status: opportunities.status,
  amount: opportunities.amount,
  currency: opportunities.currency,
  ownerUserId: opportunities.ownerUserId,
  ownerName: ownerUsers.fullName,
  stageEnteredAt: opportunities.stageEnteredAt,
  lastActivityAt: opportunities.lastActivityAt,
  nextTaskDueAt: opportunities.nextTaskDueAt,
  expectedCloseDate: opportunities.expectedCloseDate,
  createdAt: opportunities.createdAt,
};

type RawRow = Omit<OpportunityRow, 'contactName'> & { contactName: string | null };

/** Amounts are masked for viewers whose revenue.view scope doesn't cover the record. */
function present(ctx: TenantContext, row: RawRow): OpportunityRow {
  const showRevenue = canAccess(ctx, 'revenue.view', row);
  return {
    ...row,
    contactName: row.contactName ?? '',
    amount: showRevenue ? row.amount : null,
  };
}

function baseConditions(
  ctx: TenantContext,
  filters: Omit<OpportunityListFilters, 'cursor'>,
): SQL[] {
  const conditions: (SQL | undefined)[] = [
    eq(opportunities.tenantId, ctx.tenantId),
    isNull(opportunities.deletedAt),
    scopeFilter(ctx, 'opportunities.view', opportunities),
  ];
  if (filters.q) {
    conditions.push(
      or(
        ilike(opportunities.name, likePattern(filters.q)),
        ilike(contacts.fullName, likePattern(filters.q)),
      ),
    );
  }
  if (filters.status) conditions.push(eq(opportunities.status, filters.status));
  if (filters.stage) conditions.push(eq(opportunities.stageId, filters.stage));
  if (filters.owner === 'me') conditions.push(eq(opportunities.ownerUserId, ctx.userId));
  else if (filters.owner === 'unassigned') conditions.push(isNull(opportunities.ownerUserId));
  else if (filters.owner) conditions.push(eq(opportunities.ownerUserId, filters.owner));
  return conditions.filter((condition): condition is SQL => condition !== undefined);
}

const contactJoin = and(
  eq(contacts.tenantId, opportunities.tenantId),
  eq(contacts.id, opportunities.contactId),
);
const stageJoin = and(
  eq(pipelineStages.tenantId, opportunities.tenantId),
  eq(pipelineStages.id, opportunities.stageId),
);

export async function listOpportunities(
  ctx: TenantContext,
  filters: OpportunityListFilters,
): Promise<{ items: OpportunityRow[]; nextCursor: string | null }> {
  requirePermission(ctx, 'opportunities.view');
  const conditions = baseConditions(ctx, filters);
  const cursor = decodeCursor(filters.cursor);
  if (cursor) {
    conditions.push(
      or(
        lt(opportunities.createdAt, cursor.createdAt),
        and(eq(opportunities.createdAt, cursor.createdAt), lt(opportunities.id, cursor.id)),
      ) as SQL,
    );
  }

  const rows = await withRls(ctx, (tx) =>
    tx
      .select(rowColumns)
      .from(opportunities)
      .innerJoin(contacts, contactJoin)
      .innerJoin(pipelineStages, stageJoin)
      .leftJoin(ownerUsers, eq(ownerUsers.id, opportunities.ownerUserId))
      .where(and(...conditions))
      .orderBy(desc(opportunities.createdAt), desc(opportunities.id))
      .limit(OPPORTUNITY_PAGE_SIZE + 1),
  );

  const items = rows.slice(0, OPPORTUNITY_PAGE_SIZE).map((row) => present(ctx, row));
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > OPPORTUNITY_PAGE_SIZE && last ? encodeCursor(last) : null,
  };
}

/** Per-stage counts under the list's search and owner filters, for the count bar. */
export async function countOpportunitiesByStage(
  ctx: TenantContext,
  filters: OpportunityListFilters,
): Promise<Map<string, number>> {
  requirePermission(ctx, 'opportunities.view');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({ stageId: opportunities.stageId, total: count() })
      .from(opportunities)
      .innerJoin(contacts, contactJoin)
      .where(and(...baseConditions(ctx, { ...filters, stage: undefined })))
      .groupBy(opportunities.stageId),
  );
  return new Map(rows.map((row) => [row.stageId, row.total]));
}

/**
 * The pipeline board: every active stage with its cards (newest activity first), a count and
 * an amount total. Won and lost columns only show the last 30 days.
 */
export async function getBoard(
  ctx: TenantContext,
  filters: Pick<OpportunityListFilters, 'q' | 'owner'>,
): Promise<{
  pipeline: PipelineConfig;
  columns: BoardColumn[];
  currency: string;
  openTotal: string | null;
}> {
  requirePermission(ctx, 'opportunities.view');
  return withRls(ctx, async (tx) => {
    const pipeline = await loadPipelineConfig(tx, ctx);
    const closedSince = new Date(Date.now() - CLOSED_WINDOW_DAYS * 86_400_000);
    const conditions = baseConditions(ctx, filters);
    conditions.push(eq(opportunities.pipelineId, pipeline.id));
    conditions.push(
      or(eq(opportunities.status, 'open'), gte(opportunities.closedAt, closedSince)) as SQL,
    );

    const [rows, totals] = await Promise.all([
      tx
        .select(rowColumns)
        .from(opportunities)
        .innerJoin(contacts, contactJoin)
        .innerJoin(pipelineStages, stageJoin)
        .leftJoin(ownerUsers, eq(ownerUsers.id, opportunities.ownerUserId))
        .where(and(...conditions))
        .orderBy(
          sql`${opportunities.lastActivityAt} desc nulls last`,
          desc(opportunities.createdAt),
        )
        .limit(BOARD_COLUMN_LIMIT * pipeline.stages.length),
      tx
        .select({
          stageId: opportunities.stageId,
          total: count(),
          amount: sql<string>`coalesce(sum(${opportunities.amount}), 0)::text`,
        })
        .from(opportunities)
        .innerJoin(contacts, contactJoin)
        .where(and(...conditions))
        .groupBy(opportunities.stageId),
    ]);

    const now = new Date();
    const showTotals = revenueCoversView(ctx);
    const columns: BoardColumn[] = pipeline.stages
      .filter((stage) => stage.isActive)
      .map((stage) => {
        const aggregate = totals.find((row) => row.stageId === stage.id);
        const cards = rows
          .filter((row) => row.stageId === stage.id)
          .slice(0, BOARD_COLUMN_LIMIT)
          .map((row) => {
            const card = present(ctx, row);
            const lastTouch = row.lastActivityAt ?? row.stageEnteredAt;
            return {
              ...card,
              daysInStage: daysBetween(row.stageEnteredAt, now),
              isStale:
                stage.category === 'open' &&
                stage.staleAfterDays !== null &&
                daysBetween(lastTouch, now) > stage.staleAfterDays,
            };
          });
        return {
          stageId: stage.id,
          name: stage.name,
          category: stage.category,
          color: stage.color,
          count: aggregate?.total ?? 0,
          total: showTotals ? (aggregate?.amount ?? '0') : '',
          cards,
        };
      });

    const [open] = await tx
      .select({ total: sql<string>`coalesce(sum(${opportunities.amount}), 0)::text` })
      .from(opportunities)
      .innerJoin(contacts, contactJoin)
      .where(and(...conditions, eq(opportunities.status, 'open')));

    return {
      pipeline,
      columns,
      currency: ctx.tenant.currency,
      openTotal: showTotals ? (open?.total ?? '0') : null,
    };
  });
}

export async function listOpportunitiesForContact(
  ctx: TenantContext,
  contactId: string,
): Promise<OpportunityRow[]> {
  requirePermission(ctx, 'opportunities.view');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select(rowColumns)
      .from(opportunities)
      .innerJoin(contacts, contactJoin)
      .innerJoin(pipelineStages, stageJoin)
      .leftJoin(ownerUsers, eq(ownerUsers.id, opportunities.ownerUserId))
      .where(and(...baseConditions(ctx, {}), eq(opportunities.contactId, contactId)))
      .orderBy(desc(opportunities.createdAt))
      .limit(50),
  );
  return rows.map((row) => present(ctx, row));
}

export async function getOpportunity(ctx: TenantContext, id: string): Promise<OpportunityDetail> {
  requirePermission(ctx, 'opportunities.view');
  const partnerOrgs = alias(organizations, 'partner_orgs');
  const enteredByUsers = alias(users, 'entered_by_users');

  return withRls(ctx, async (tx) => {
    const [row] = await tx
      .select({
        ...rowColumns,
        pipelineId: opportunities.pipelineId,
        organizationId: opportunities.organizationId,
        organizationName: organizations.name,
        sourceId: opportunities.sourceId,
        sourceName: leadSources.name,
        partnerId: opportunities.partnerId,
        partnerName: partnerOrgs.name,
        lostReasonId: opportunities.lostReasonId,
        lostReasonName: lostReasons.name,
        lostReasonNote: opportunities.lostReasonNote,
        closedAt: opportunities.closedAt,
      })
      .from(opportunities)
      .innerJoin(contacts, contactJoin)
      .innerJoin(pipelineStages, stageJoin)
      .leftJoin(ownerUsers, eq(ownerUsers.id, opportunities.ownerUserId))
      .leftJoin(
        organizations,
        and(
          eq(organizations.tenantId, opportunities.tenantId),
          eq(organizations.id, opportunities.organizationId),
        ),
      )
      .leftJoin(
        leadSources,
        and(
          eq(leadSources.tenantId, opportunities.tenantId),
          eq(leadSources.id, opportunities.sourceId),
        ),
      )
      .leftJoin(
        partners,
        and(
          eq(partners.tenantId, opportunities.tenantId),
          eq(partners.id, opportunities.partnerId),
        ),
      )
      .leftJoin(
        partnerOrgs,
        and(
          eq(partnerOrgs.tenantId, partners.tenantId),
          eq(partnerOrgs.id, partners.organizationId),
        ),
      )
      .leftJoin(
        lostReasons,
        and(
          eq(lostReasons.tenantId, opportunities.tenantId),
          eq(lostReasons.id, opportunities.lostReasonId),
        ),
      )
      .where(
        and(
          eq(opportunities.tenantId, ctx.tenantId),
          eq(opportunities.id, id),
          isNull(opportunities.deletedAt),
        ),
      )
      .limit(1);

    if (!row) throw new AppError('NOT_FOUND', 'That record was not found.');
    assertCanAccess(ctx, 'opportunities.view', row);

    const history = await tx
      .select({
        stageId: stageHistory.stageId,
        stageName: pipelineStages.name,
        enteredAt: stageHistory.enteredAt,
        exitedAt: stageHistory.exitedAt,
        enteredByName: enteredByUsers.fullName,
      })
      .from(stageHistory)
      .innerJoin(
        pipelineStages,
        and(
          eq(pipelineStages.tenantId, stageHistory.tenantId),
          eq(pipelineStages.id, stageHistory.stageId),
        ),
      )
      .leftJoin(enteredByUsers, eq(enteredByUsers.id, stageHistory.enteredBy))
      .where(and(eq(stageHistory.tenantId, ctx.tenantId), eq(stageHistory.opportunityId, id)))
      .orderBy(asc(stageHistory.enteredAt));

    return {
      ...present(ctx, row),
      pipelineId: row.pipelineId,
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      sourceId: row.sourceId,
      sourceName: row.sourceName,
      partnerId: row.partnerId,
      partnerName: row.partnerName,
      lostReasonId: row.lostReasonId,
      lostReasonName: row.lostReasonName,
      lostReasonNote: row.lostReasonNote,
      closedAt: row.closedAt,
      canViewRevenue: canAccess(ctx, 'revenue.view', row),
      history,
    };
  });
}

export type { OpportunityStatus };
