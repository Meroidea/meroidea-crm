import 'server-only';

import { and, eq, gte, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  activities,
  contacts,
  leadSources,
  lostReasons,
  opportunities,
  pipelineStages,
  stageHistory,
  tasks,
  users,
} from '@/db/schema';
import { startOfZonedMonth } from '@/lib/dates';
import type { Grant } from '@/lib/permissions/catalog';
import { scopeFilter } from '@/lib/permissions/scope';
import { loadPipelineConfig } from '@/modules/pipelines/queries';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

/** Dates inside raw SQL need an explicit type; the driver can't infer one for a bare Date. */
const at = (date: Date) => sql`${date.toISOString()}::timestamptz`;

const RANK = { own: 1, team: 2, all: 3 } as const;
const rank = (grant: Grant | undefined) =>
  grant === undefined ? 0 : grant === true ? 3 : RANK[grant];

/** Money totals only when revenue access reaches as far as the report's scope. */
export function canSeeRevenueTotals(ctx: TenantContext): boolean {
  return rank(ctx.grants.get('revenue.view')) >= rank(ctx.grants.get('reports.view'));
}

function reportScope(ctx: TenantContext): SQL | undefined {
  return scopeFilter(ctx, 'reports.view', opportunities);
}

const live = (ctx: TenantContext) => [
  eq(opportunities.tenantId, ctx.tenantId),
  isNull(opportunities.deletedAt),
];

export type Dashboard = {
  showMoney: boolean;
  currency: string;
  kpis: {
    openCount: number;
    openValue: string;
    weightedValue: string;
    wonThisMonthCount: number;
    wonThisMonthValue: string;
    winRate: number | null;
    newContacts30d: number;
    newOpportunities30d: number;
  };
  stages: { id: string; name: string; color: string | null; count: number; value: string }[];
  trend: { month: string; won: string; created: number }[];
  sources: { name: string; count: number; won: number }[];
  stale: {
    id: string;
    name: string;
    contactName: string;
    stageName: string;
    days: number;
    ownerName: string | null;
  }[];
  leaderboard: { name: string; won: string; count: number }[];
};

export async function getDashboard(ctx: TenantContext): Promise<Dashboard | null> {
  if (!hasPermission(ctx, 'reports.view')) return null;
  const showMoney = canSeeRevenueTotals(ctx);
  const scope = reportScope(ctx);
  const monthStart = startOfZonedMonth(ctx.tenant.timezone);
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const since90 = new Date(Date.now() - 90 * 86_400_000);
  const since6m = new Date(Date.now() - 183 * 86_400_000);

  return withRls(ctx, async (tx) => {
    const pipeline = await loadPipelineConfig(tx, ctx);

    const [kpiRow] = await tx
      .select({
        openCount: sql<number>`count(*) filter (where ${opportunities.status} = 'open')::int`,
        openValue: sql<string>`coalesce(sum(${opportunities.amount}) filter (where ${opportunities.status} = 'open'), 0)::text`,
        weightedValue: sql<string>`coalesce(sum(${opportunities.amount} * coalesce(${pipelineStages.probability}, 0) / 100.0) filter (where ${opportunities.status} = 'open'), 0)::numeric(14,2)::text`,
        wonThisMonthCount: sql<number>`count(*) filter (where ${opportunities.status} = 'won' and ${opportunities.closedAt} >= ${at(monthStart)})::int`,
        wonThisMonthValue: sql<string>`coalesce(sum(${opportunities.amount}) filter (where ${opportunities.status} = 'won' and ${opportunities.closedAt} >= ${at(monthStart)}), 0)::text`,
        won90: sql<number>`count(*) filter (where ${opportunities.status} = 'won' and ${opportunities.closedAt} >= ${at(since90)})::int`,
        lost90: sql<number>`count(*) filter (where ${opportunities.status} = 'lost' and ${opportunities.closedAt} >= ${at(since90)})::int`,
        new30: sql<number>`count(*) filter (where ${opportunities.createdAt} >= ${at(since30)})::int`,
      })
      .from(opportunities)
      .innerJoin(
        pipelineStages,
        and(
          eq(pipelineStages.tenantId, opportunities.tenantId),
          eq(pipelineStages.id, opportunities.stageId),
        ),
      )
      .where(and(...live(ctx), scope));

    const [contactRow] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(contacts)
      .where(
        and(
          eq(contacts.tenantId, ctx.tenantId),
          isNull(contacts.deletedAt),
          gte(contacts.createdAt, since30),
          scopeFilter(ctx, 'contacts.view', contacts),
        ),
      );

    const stageRows = await tx
      .select({
        stageId: opportunities.stageId,
        count: sql<number>`count(*)::int`,
        value: sql<string>`coalesce(sum(${opportunities.amount}), 0)::text`,
      })
      .from(opportunities)
      .where(and(...live(ctx), scope, eq(opportunities.status, 'open')))
      .groupBy(opportunities.stageId);

    const trendRows = await tx
      .select({
        month: sql<string>`to_char(date_trunc('month', ${opportunities.createdAt} at time zone ${ctx.tenant.timezone}), 'YYYY-MM')`,
        created: sql<number>`count(*)::int`,
      })
      .from(opportunities)
      .where(and(...live(ctx), scope, gte(opportunities.createdAt, since6m)))
      .groupBy(sql`1`);
    const wonRows = await tx
      .select({
        month: sql<string>`to_char(date_trunc('month', ${opportunities.closedAt} at time zone ${ctx.tenant.timezone}), 'YYYY-MM')`,
        won: sql<string>`coalesce(sum(${opportunities.amount}), 0)::text`,
      })
      .from(opportunities)
      .where(
        and(
          ...live(ctx),
          scope,
          eq(opportunities.status, 'won'),
          gte(opportunities.closedAt, since6m),
        ),
      )
      .groupBy(sql`1`);

    const sourceRows = await tx
      .select({
        name: sql<string>`coalesce(${leadSources.name}, 'Not recorded')`,
        count: sql<number>`count(*)::int`,
        won: sql<number>`count(*) filter (where ${opportunities.status} = 'won')::int`,
      })
      .from(opportunities)
      .leftJoin(
        leadSources,
        and(
          eq(leadSources.tenantId, opportunities.tenantId),
          eq(leadSources.id, opportunities.sourceId),
        ),
      )
      .where(and(...live(ctx), scope, gte(opportunities.createdAt, since90)))
      .groupBy(sql`1`)
      .orderBy(sql`2 desc`)
      .limit(6);

    const owners = alias(users, 'owners');
    const staleRows = await tx
      .select({
        id: opportunities.id,
        name: opportunities.name,
        contactName: contacts.fullName,
        stageName: pipelineStages.name,
        days: sql<number>`extract(day from now() - coalesce(${opportunities.lastActivityAt}, ${opportunities.stageEnteredAt}))::int`,
        ownerName: owners.fullName,
      })
      .from(opportunities)
      .innerJoin(
        pipelineStages,
        and(
          eq(pipelineStages.tenantId, opportunities.tenantId),
          eq(pipelineStages.id, opportunities.stageId),
        ),
      )
      .innerJoin(
        contacts,
        and(
          eq(contacts.tenantId, opportunities.tenantId),
          eq(contacts.id, opportunities.contactId),
        ),
      )
      .leftJoin(owners, eq(owners.id, opportunities.ownerUserId))
      .where(
        and(
          ...live(ctx),
          scopeFilter(ctx, 'opportunities.view', opportunities),
          eq(opportunities.status, 'open'),
          sql`${pipelineStages.staleAfterDays} is not null`,
          sql`coalesce(${opportunities.lastActivityAt}, ${opportunities.stageEnteredAt}) < now() - make_interval(days => ${pipelineStages.staleAfterDays})`,
        ),
      )
      .orderBy(sql`coalesce(${opportunities.lastActivityAt}, ${opportunities.stageEnteredAt}) asc`)
      .limit(6);

    const quarterStart = new Date(Date.now() - 90 * 86_400_000);
    const leaderRows =
      ctx.grants.get('reports.view') === 'own'
        ? []
        : await tx
            .select({
              name: sql<string>`coalesce(${owners.fullName}, 'Unassigned')`,
              won: sql<string>`coalesce(sum(${opportunities.amount}), 0)::text`,
              count: sql<number>`count(*)::int`,
            })
            .from(opportunities)
            .leftJoin(owners, eq(owners.id, opportunities.ownerUserId))
            .where(
              and(
                ...live(ctx),
                scope,
                eq(opportunities.status, 'won'),
                gte(opportunities.closedAt, quarterStart),
              ),
            )
            .groupBy(sql`1`)
            .orderBy(sql`count(*) desc`)
            .limit(5);

    const months: string[] = [];
    const now = new Date();
    for (let back = 5; back >= 0; back -= 1) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
      months.push(date.toISOString().slice(0, 7));
    }
    const k = kpiRow ?? {
      openCount: 0,
      openValue: '0',
      weightedValue: '0',
      wonThisMonthCount: 0,
      wonThisMonthValue: '0',
      won90: 0,
      lost90: 0,
      new30: 0,
    };
    const mask = (value: string) => (showMoney ? value : '');

    return {
      showMoney,
      currency: ctx.tenant.currency,
      kpis: {
        openCount: k.openCount,
        openValue: mask(k.openValue),
        weightedValue: mask(k.weightedValue),
        wonThisMonthCount: k.wonThisMonthCount,
        wonThisMonthValue: mask(k.wonThisMonthValue),
        winRate: k.won90 + k.lost90 > 0 ? Math.round((k.won90 / (k.won90 + k.lost90)) * 100) : null,
        newContacts30d: contactRow?.total ?? 0,
        newOpportunities30d: k.new30,
      },
      stages: pipeline.stages
        .filter((stage) => stage.isActive && stage.category === 'open')
        .map((stage) => {
          const row = stageRows.find((candidate) => candidate.stageId === stage.id);
          return {
            id: stage.id,
            name: stage.name,
            color: stage.color,
            count: row?.count ?? 0,
            value: mask(row?.value ?? '0'),
          };
        }),
      trend: months.map((month) => ({
        month,
        created: trendRows.find((row) => row.month === month)?.created ?? 0,
        won: mask(wonRows.find((row) => row.month === month)?.won ?? '0'),
      })),
      sources: sourceRows,
      stale: staleRows.map((row) => ({ ...row, contactName: row.contactName ?? '' })),
      leaderboard: leaderRows.map((row) => ({ ...row, won: mask(row.won) })),
    };
  });
}

export type ReportRange = 30 | 90 | 365;

export type Reports = {
  range: ReportRange;
  showMoney: boolean;
  currency: string;
  funnel: { stage: string; reached: number }[];
  bySource: { name: string; created: number; won: number; lost: number }[];
  byOwner: { name: string; created: number; won: number; value: string }[];
  timeInStage: { stage: string; avgDays: number; visits: number }[];
  followUp: { onTime: number; late: number; open: number; overdue: number };
  activityByUser: {
    name: string;
    calls: number;
    emails: number;
    meetings: number;
    notes: number;
    total: number;
  }[];
  lostReasons: { name: string; count: number }[];
};

export async function getReports(ctx: TenantContext, range: ReportRange): Promise<Reports> {
  requirePermission(ctx, 'reports.view');
  const showMoney = canSeeRevenueTotals(ctx);
  const scope = reportScope(ctx);
  const since = new Date(Date.now() - range * 86_400_000);
  const owners = alias(users, 'owners');

  return withRls(ctx, async (tx) => {
    const pipeline = await loadPipelineConfig(tx, ctx);

    // Cohort funnel: of the opportunities created in range, how many ever reached each stage.
    const reachedRows = await tx
      .select({
        stageId: stageHistory.stageId,
        reached: sql<number>`count(distinct ${stageHistory.opportunityId})::int`,
      })
      .from(stageHistory)
      .innerJoin(
        opportunities,
        and(
          eq(opportunities.tenantId, stageHistory.tenantId),
          eq(opportunities.id, stageHistory.opportunityId),
        ),
      )
      .where(and(...live(ctx), scope, gte(opportunities.createdAt, since)))
      .groupBy(stageHistory.stageId);
    const ordered = pipeline.stages.filter((stage) => stage.isActive && stage.category !== 'lost');
    // Reaching a later stage implies passing the earlier ones, even if a stage was skipped.
    const funnel = ordered.map((stage, index) => ({
      stage: stage.name,
      reached: Math.max(
        0,
        ...ordered
          .slice(index)
          .map((later) => reachedRows.find((row) => row.stageId === later.id)?.reached ?? 0),
      ),
    }));

    const bySource = await tx
      .select({
        name: sql<string>`coalesce(${leadSources.name}, 'Not recorded')`,
        created: sql<number>`count(*)::int`,
        won: sql<number>`count(*) filter (where ${opportunities.status} = 'won')::int`,
        lost: sql<number>`count(*) filter (where ${opportunities.status} = 'lost')::int`,
      })
      .from(opportunities)
      .leftJoin(
        leadSources,
        and(
          eq(leadSources.tenantId, opportunities.tenantId),
          eq(leadSources.id, opportunities.sourceId),
        ),
      )
      .where(and(...live(ctx), scope, gte(opportunities.createdAt, since)))
      .groupBy(sql`1`)
      .orderBy(sql`2 desc`);

    const byOwner = await tx
      .select({
        name: sql<string>`coalesce(${owners.fullName}, 'Unassigned')`,
        created: sql<number>`count(*) filter (where ${opportunities.createdAt} >= ${at(since)})::int`,
        won: sql<number>`count(*) filter (where ${opportunities.status} = 'won' and ${opportunities.closedAt} >= ${at(since)})::int`,
        value: sql<string>`coalesce(sum(${opportunities.amount}) filter (where ${opportunities.status} = 'won' and ${opportunities.closedAt} >= ${at(since)}), 0)::text`,
      })
      .from(opportunities)
      .leftJoin(owners, eq(owners.id, opportunities.ownerUserId))
      .where(and(...live(ctx), scope))
      .groupBy(sql`1`)
      .orderBy(sql`3 desc, 2 desc`);

    const timeRows = await tx
      .select({
        stageId: stageHistory.stageId,
        avgDays: sql<number>`coalesce(round(avg(extract(epoch from (coalesce(${stageHistory.exitedAt}, now()) - ${stageHistory.enteredAt})) / 86400)::numeric, 1), 0)::float`,
        visits: sql<number>`count(*)::int`,
      })
      .from(stageHistory)
      .innerJoin(
        opportunities,
        and(
          eq(opportunities.tenantId, stageHistory.tenantId),
          eq(opportunities.id, stageHistory.opportunityId),
        ),
      )
      .where(and(...live(ctx), scope, gte(stageHistory.enteredAt, since)))
      .groupBy(stageHistory.stageId);

    const taskScope = scopeFilter(ctx, 'reports.view', { ownerUserId: tasks.assignedTo });
    const [followUp] = await tx
      .select({
        onTime: sql<number>`count(*) filter (where ${tasks.status} = 'completed' and ${tasks.completedAt} <= ${tasks.dueAt})::int`,
        late: sql<number>`count(*) filter (where ${tasks.status} = 'completed' and ${tasks.completedAt} > ${tasks.dueAt})::int`,
        open: sql<number>`count(*) filter (where ${tasks.status} = 'open' and ${tasks.dueAt} >= now())::int`,
        overdue: sql<number>`count(*) filter (where ${tasks.status} = 'open' and ${tasks.dueAt} < now())::int`,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.tenantId, ctx.tenantId),
          isNull(tasks.deletedAt),
          taskScope,
          gte(tasks.dueAt, since),
        ),
      );

    const actors = alias(users, 'actors');
    const activityByUser = await tx
      .select({
        name: sql<string>`coalesce(${actors.fullName}, 'System')`,
        calls: sql<number>`count(*) filter (where ${activities.type} = 'call')::int`,
        emails: sql<number>`count(*) filter (where ${activities.type} = 'email')::int`,
        meetings: sql<number>`count(*) filter (where ${activities.type} = 'meeting')::int`,
        notes: sql<number>`count(*) filter (where ${activities.type} in ('note', 'message'))::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(activities)
      .innerJoin(actors, eq(actors.id, activities.actorUserId))
      .where(
        and(
          eq(activities.tenantId, ctx.tenantId),
          isNull(activities.deletedAt),
          gte(activities.occurredAt, since),
          sql`${activities.type} in ('call', 'email', 'meeting', 'note', 'message')`,
          scopeFilter(ctx, 'reports.view', { ownerUserId: activities.actorUserId }),
        ),
      )
      .groupBy(sql`1`)
      .orderBy(sql`6 desc`);

    const lostRows = await tx
      .select({
        name: sql<string>`coalesce(${lostReasons.name}, 'Unknown')`,
        count: sql<number>`count(*)::int`,
      })
      .from(opportunities)
      .leftJoin(
        lostReasons,
        and(
          eq(lostReasons.tenantId, opportunities.tenantId),
          eq(lostReasons.id, opportunities.lostReasonId),
        ),
      )
      .where(
        and(
          ...live(ctx),
          scope,
          eq(opportunities.status, 'lost'),
          gte(opportunities.closedAt, since),
        ),
      )
      .groupBy(sql`1`)
      .orderBy(sql`2 desc`);

    return {
      range,
      showMoney,
      currency: ctx.tenant.currency,
      funnel,
      bySource,
      byOwner: byOwner.map((row) => ({ ...row, value: showMoney ? row.value : '' })),
      timeInStage: pipeline.stages
        .filter((stage) => stage.isActive && stage.category === 'open')
        .map((stage) => {
          const row = timeRows.find((candidate) => candidate.stageId === stage.id);
          return { stage: stage.name, avgDays: row?.avgDays ?? 0, visits: row?.visits ?? 0 };
        }),
      followUp: followUp ?? { onTime: 0, late: 0, open: 0, overdue: 0 },
      activityByUser,
      lostReasons: lostRows,
    };
  });
}
