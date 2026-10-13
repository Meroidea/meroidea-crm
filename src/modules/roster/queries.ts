import 'server-only';

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte } from 'drizzle-orm';

import {
  employees,
  employmentContracts,
  leaveRequests,
  leaveTypes,
  publicHolidays,
  rosterShifts,
  rosterTeamMembers,
  rosterTeams,
  rosters,
  workforceSettings,
} from '@/db/schema';
import { instantToZoned } from '@/lib/dates';
import { dayLoadings } from '@/modules/hiring/award-rates';
import { hasFeature, hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { DEFAULT_BREAK_RULES, ORDINARY_LOADINGS, type TeamColor } from './rules';
import type {
  RemovedShift,
  RosterLeave,
  RosterRates,
  RosterRules,
  RosterShift,
  RosterSummary,
  RosterTeam,
} from './types';

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
  const manages = hasPermission(ctx, 'rosters.manage');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        id: rosterShifts.id,
        userId: rosterShifts.userId,
        teamId: rosterShifts.teamId,
        startsAt: rosterShifts.startsAt,
        endsAt: rosterShifts.endsAt,
        breakMinutes: rosterShifts.breakMinutes,
        breaks: rosterShifts.breaks,
        autoBreaks: rosterShifts.autoBreaks,
        note: rosterShifts.note,
        publishedAt: rosterShifts.publishedAt,
        unpublishedChanges: rosterShifts.unpublishedChanges,
      })
      .from(rosterShifts)
      .where(
        and(
          eq(rosterShifts.tenantId, ctx.tenantId),
          eq(rosterShifts.rosterId, rosterId),
          isNull(rosterShifts.deletedAt),
          // Only whoever builds the roster sees a shift before it is published.
          manages ? undefined : isNotNull(rosterShifts.publishedAt),
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
      teamId: row.teamId,
      date: start.date,
      startTime: start.time,
      endTime: end.time,
      overnight: end.date !== start.date,
      breaks: row.breaks,
      autoBreaks: row.autoBreaks,
      breakMinutes: row.breakMinutes,
      paidMinutes: minutes - row.breakMinutes,
      note: row.note,
      published: row.publishedAt !== null,
      unpublishedChanges: row.unpublishedChanges,
    };
  });
}

/** Published shifts removed since the last publish: the people on them have not been told. */
export async function listRemovedShifts(
  ctx: TenantContext,
  rosterId: string,
): Promise<RemovedShift[]> {
  requirePermission(ctx, 'rosters.manage');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        id: rosterShifts.id,
        userId: rosterShifts.userId,
        startsAt: rosterShifts.startsAt,
        endsAt: rosterShifts.endsAt,
      })
      .from(rosterShifts)
      .where(
        and(
          eq(rosterShifts.tenantId, ctx.tenantId),
          eq(rosterShifts.rosterId, rosterId),
          isNotNull(rosterShifts.deletedAt),
          rosterShifts.unpublishedChanges,
        ),
      )
      .orderBy(asc(rosterShifts.startsAt)),
  );
  const timezone = ctx.tenant.timezone;
  return rows.map((row) => {
    const start = instantToZoned(timezone, row.startsAt);
    return {
      id: row.id,
      userId: row.userId,
      date: start.date,
      startTime: start.time,
      endTime: instantToZoned(timezone, row.endsAt).time,
    };
  });
}

/** The workspace's teams. Membership comes back only as far as the person may see it. */
export async function listRosterTeams(ctx: TenantContext): Promise<RosterTeam[]> {
  requirePermission(ctx, 'rosters.view');
  return withRls(ctx, async (tx) => {
    const teams = await tx
      .select({ id: rosterTeams.id, name: rosterTeams.name, color: rosterTeams.color })
      .from(rosterTeams)
      .where(and(eq(rosterTeams.tenantId, ctx.tenantId), isNull(rosterTeams.deletedAt)))
      .orderBy(asc(rosterTeams.name));
    const members = teams.length
      ? await tx
          .select({ teamId: rosterTeamMembers.teamId, userId: rosterTeamMembers.userId })
          .from(rosterTeamMembers)
          .where(eq(rosterTeamMembers.tenantId, ctx.tenantId))
      : [];
    return teams.map((team) => ({
      id: team.id,
      name: team.name,
      color: team.color as TeamColor,
      memberIds: members.filter((row) => row.teamId === team.id).map((row) => row.userId),
    }));
  });
}

/** Loadings, break rules and public holidays; ordinary rates until the workspace saves its own. */
export async function getRosterRules(ctx: TenantContext): Promise<RosterRules> {
  requirePermission(ctx, 'rosters.view');
  return withRls(ctx, async (tx) => {
    const [settings] = await tx
      .select()
      .from(workforceSettings)
      .where(eq(workforceSettings.tenantId, ctx.tenantId))
      .limit(1);
    const holidays = await tx
      .select({ id: publicHolidays.id, day: publicHolidays.day, name: publicHolidays.name })
      .from(publicHolidays)
      .where(eq(publicHolidays.tenantId, ctx.tenantId))
      .orderBy(asc(publicHolidays.day));
    return {
      loadings: settings
        ? {
            saturday: Number(settings.saturdayLoading),
            sunday: Number(settings.sundayLoading),
            publicHoliday: Number(settings.publicHolidayLoading),
          }
        : ORDINARY_LOADINGS,
      breakRules: settings ? settings.breakRules : DEFAULT_BREAK_RULES,
      holidays,
    };
  });
}

/**
 * Each person's hourly rate from their latest accepted contract, for costing shifts. Pay is
 * only for whoever manages employee records, so everyone else gets null and sees no cost.
 */
export async function listRosterRates(ctx: TenantContext): Promise<RosterRates | null> {
  if (!hasPermission(ctx, 'rosters.manage') || !hasPermission(ctx, 'employees.manage')) return null;
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        userId: employees.userId,
        payBasis: employmentContracts.payBasis,
        payRate: employmentContracts.payRate,
        rateSchedule: employmentContracts.rateSchedule,
      })
      .from(employmentContracts)
      .innerJoin(
        employees,
        and(
          eq(employees.tenantId, employmentContracts.tenantId),
          eq(employees.id, employmentContracts.employeeId),
        ),
      )
      .where(
        and(
          eq(employmentContracts.tenantId, ctx.tenantId),
          eq(employmentContracts.status, 'accepted'),
          isNull(employmentContracts.deletedAt),
          isNull(employees.deletedAt),
          isNotNull(employees.userId),
        ),
      )
      .orderBy(desc(employmentContracts.acceptedAt)),
  );
  const rates: RosterRates = {};
  const seen = new Set<string>();
  for (const row of rows) {
    // Newest contract first: an annual salary there means roster hours are not what is paid.
    if (!row.userId || seen.has(row.userId)) continue;
    seen.add(row.userId);
    if (row.payBasis === 'hourly') {
      rates[row.userId] = {
        hourly: row.payRate,
        loadings: dayLoadings(row.rateSchedule?.dayRates ?? null),
      };
    }
  }
  return rates;
}

/** Pending and approved time away that overlaps the given days, as far as the person may see. */
export async function listRosterLeave(
  ctx: TenantContext,
  from: string,
  to: string,
): Promise<RosterLeave[]> {
  requirePermission(ctx, 'rosters.view');
  if (!hasFeature(ctx, 'timeoff')) return [];
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        userId: leaveRequests.userId,
        startsOn: leaveRequests.startsOn,
        endsOn: leaveRequests.endsOn,
        status: leaveRequests.status,
        typeName: leaveTypes.name,
      })
      .from(leaveRequests)
      .innerJoin(
        leaveTypes,
        and(
          eq(leaveTypes.tenantId, leaveRequests.tenantId),
          eq(leaveTypes.id, leaveRequests.leaveTypeId),
        ),
      )
      .where(
        and(
          eq(leaveRequests.tenantId, ctx.tenantId),
          inArray(leaveRequests.status, ['pending', 'approved']),
          lte(leaveRequests.startsOn, to),
          gte(leaveRequests.endsOn, from),
        ),
      ),
  );
  return rows.map((row) => ({ ...row, status: row.status as RosterLeave['status'] }));
}
