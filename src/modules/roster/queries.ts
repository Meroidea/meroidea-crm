import 'server-only';

import { and, asc, desc, eq, gte, isNull, lt, lte } from 'drizzle-orm';

import { rosterShifts, rosters } from '@/db/schema';
import { instantToZoned } from '@/lib/dates';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { RosterShift, RosterSummary } from './types';

const summary = {
  id: rosters.id,
  startsOn: rosters.startsOn,
  endsOn: rosters.endsOn,
  status: rosters.status,
  publishedAt: rosters.publishedAt,
  authorisedAt: rosters.authorisedAt,
};

/**
 * The roster whose period contains `date`, if there is one the person may see. Someone who
 * cannot manage rosters only ever gets a published one; the database enforces the same rule.
 */
export async function getRosterForDate(
  ctx: TenantContext,
  date: string,
): Promise<RosterSummary | null> {
  requirePermission(ctx, 'rosters.view');
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select(summary)
      .from(rosters)
      .where(
        and(
          eq(rosters.tenantId, ctx.tenantId),
          isNull(rosters.deletedAt),
          lte(rosters.startsOn, date),
          gte(rosters.endsOn, date),
          hasPermission(ctx, 'rosters.manage') ? undefined : eq(rosters.status, 'published'),
        ),
      )
      .limit(1),
  );
  return row ?? null;
}

/** Whether an earlier roster exists to copy shifts from when creating one starting `startsOn`. */
export async function hasEarlierRoster(ctx: TenantContext, startsOn: string): Promise<boolean> {
  requirePermission(ctx, 'rosters.manage');
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({ id: rosters.id })
      .from(rosters)
      .where(
        and(
          eq(rosters.tenantId, ctx.tenantId),
          isNull(rosters.deletedAt),
          lt(rosters.endsOn, startsOn),
        ),
      )
      .orderBy(desc(rosters.startsOn))
      .limit(1),
  );
  return Boolean(row);
}

/** Owners, managers and whoever builds the roster see everyone on it; other staff see themselves. */
export function canSeeWholeRoster(ctx: TenantContext): boolean {
  return hasPermission(ctx, 'rosters.view_all') || hasPermission(ctx, 'rosters.manage');
}

export async function listRosterShifts(
  ctx: TenantContext,
  rosterId: string,
): Promise<RosterShift[]> {
  requirePermission(ctx, 'rosters.view');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        id: rosterShifts.id,
        userId: rosterShifts.userId,
        startsAt: rosterShifts.startsAt,
        endsAt: rosterShifts.endsAt,
        breakMinutes: rosterShifts.breakMinutes,
        position: rosterShifts.position,
        note: rosterShifts.note,
      })
      .from(rosterShifts)
      .where(
        and(
          eq(rosterShifts.tenantId, ctx.tenantId),
          eq(rosterShifts.rosterId, rosterId),
          isNull(rosterShifts.deletedAt),
          // General staff see their own shifts only; RLS enforces the same.
          canSeeWholeRoster(ctx) ? undefined : eq(rosterShifts.userId, ctx.userId),
        ),
      )
      .orderBy(asc(rosterShifts.startsAt)),
  );

  const timezone = ctx.tenant.timezone;
  return rows.map((row) => {
    const start = instantToZoned(timezone, row.startsAt);
    const end = instantToZoned(timezone, row.endsAt);
    const minutes = Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 60_000);
    return {
      id: row.id,
      userId: row.userId,
      date: start.date,
      startTime: start.time,
      endTime: end.time,
      overnight: end.date !== start.date,
      breakMinutes: row.breakMinutes,
      paidMinutes: minutes - row.breakMinutes,
      position: row.position,
      note: row.note,
    };
  });
}
