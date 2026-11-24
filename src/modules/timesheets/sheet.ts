import 'server-only';

import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte } from 'drizzle-orm';

import { rosterShifts, rosters, timeEntries, users } from '@/db/schema';
import { addDaysToDate, instantToZoned, mondayOf, zonedDateToInstant } from '@/lib/dates';
import { listRosterTeams } from '@/modules/roster/queries';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { DayEntry, DayShift } from './day';
import { sheetRows, type SheetRow } from './sheet-rows';

export type TimesheetPerson = {
  userId: string;
  fullName: string;
  rows: SheetRow[];
  /** Time on approved entries: what is, or will be, paid. */
  approvedMinutes: number;
};

export type Timesheet = {
  from: string;
  to: string;
  /** The pay period has been authorised for pay: the times shown are the authorised ones. */
  locked: boolean;
  /** Everyone's timesheet (timesheets.manage), or only the signed-in person's. */
  everyone: boolean;
  people: TimesheetPerson[];
};

/**
 * The Timesheet view for the pay period containing `date` (ADR-083): the roster's period when a
 * published roster covers the day, else that calendar week. Someone who manages timesheets sees
 * everyone; anyone else sees only themselves, which the database's row rules also enforce for
 * both shifts and time.
 */
export async function getTimesheet(ctx: TenantContext, date: string): Promise<Timesheet> {
  requirePermission(ctx, 'timesheets.clock');
  const everyone = hasPermission(ctx, 'timesheets.manage');
  const seesRoster = hasPermission(ctx, 'rosters.view');
  const timezone = ctx.tenant.timezone;

  const data = await withRls(ctx, async (tx) => {
    const [roster] = seesRoster
      ? await tx
          .select({
            startsOn: rosters.startsOn,
            endsOn: rosters.endsOn,
            authorisedAt: rosters.authorisedAt,
          })
          .from(rosters)
          .where(
            and(
              eq(rosters.tenantId, ctx.tenantId),
              isNull(rosters.deletedAt),
              eq(rosters.status, 'published'),
              lte(rosters.startsOn, date),
              gte(rosters.endsOn, date),
            ),
          )
          .limit(1)
      : [];
    const from = roster?.startsOn ?? mondayOf(date);
    const to = roster?.endsOn ?? addDaysToDate(from, 6);
    const start = zonedDateToInstant(timezone, from);
    const end = zonedDateToInstant(timezone, addDaysToDate(to, 1));
    const own = everyone ? undefined : ctx.userId;

    const shifts = seesRoster
      ? await tx
          .select({
            id: rosterShifts.id,
            userId: rosterShifts.userId,
            teamId: rosterShifts.teamId,
            startsAt: rosterShifts.startsAt,
            endsAt: rosterShifts.endsAt,
            breakMinutes: rosterShifts.breakMinutes,
          })
          .from(rosterShifts)
          .where(
            and(
              eq(rosterShifts.tenantId, ctx.tenantId),
              isNull(rosterShifts.deletedAt),
              // Staff work to a shift once it has been published to them.
              isNotNull(rosterShifts.publishedAt),
              isNotNull(rosterShifts.userId),
              own ? eq(rosterShifts.userId, own) : undefined,
              gte(rosterShifts.startsAt, start),
              lt(rosterShifts.startsAt, end),
            ),
          )
          .orderBy(asc(rosterShifts.startsAt))
      : [];
    const entries = await tx
      .select({
        id: timeEntries.id,
        userId: timeEntries.userId,
        shiftId: timeEntries.shiftId,
        clockIn: timeEntries.clockIn,
        clockOut: timeEntries.clockOut,
        breakMinutes: timeEntries.breakMinutes,
        status: timeEntries.status,
        source: timeEntries.source,
        note: timeEntries.note,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.tenantId, ctx.tenantId),
          isNull(timeEntries.deletedAt),
          own ? eq(timeEntries.userId, own) : undefined,
          gte(timeEntries.clockIn, start),
          lt(timeEntries.clockIn, end),
        ),
      )
      .orderBy(asc(timeEntries.clockIn));
    const userIds = [
      ...new Set([
        ...shifts.flatMap((shift) => shift.userId ?? []),
        ...entries.map((entry) => entry.userId),
        ...(own ? [own] : []),
      ]),
    ];
    const people = userIds.length
      ? await tx
          .select({ id: users.id, fullName: users.fullName })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];
    return { from, to, locked: Boolean(roster?.authorisedAt), shifts, entries, people };
  });

  const teams = seesRoster ? await listRosterTeams(ctx) : [];
  const teamName = new Map(teams.map((team) => [team.id, team.name]));
  const shifts: DayShift[] = data.shifts.flatMap((row) => {
    if (!row.userId) return [];
    const startsAt = instantToZoned(timezone, row.startsAt);
    const minutes = Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 60_000);
    return [
      {
        id: row.id,
        userId: row.userId,
        teamId: row.teamId,
        date: startsAt.date,
        startTime: startsAt.time,
        endTime: instantToZoned(timezone, row.endsAt).time,
        breakMinutes: row.breakMinutes,
        paidMinutes: minutes - row.breakMinutes,
      },
    ];
  });
  const entries: DayEntry[] = data.entries.map((row) => {
    const clockIn = instantToZoned(timezone, row.clockIn);
    const minutes = row.clockOut
      ? Math.round((row.clockOut.getTime() - row.clockIn.getTime()) / 60_000)
      : 0;
    return {
      id: row.id,
      userId: row.userId,
      shiftId: row.shiftId,
      date: clockIn.date,
      startTime: clockIn.time,
      endTime: row.clockOut ? instantToZoned(timezone, row.clockOut).time : null,
      breakMinutes: row.breakMinutes,
      workedMinutes: Math.max(0, minutes - row.breakMinutes),
      status: row.status as DayEntry['status'],
      source: row.source as DayEntry['source'],
    };
  });
  const now = instantToZoned(timezone, new Date());
  const rows = sheetRows({
    shifts,
    entries,
    teamOf: (teamId) => (teamId ? (teamName.get(teamId) ?? null) : null),
    noteOf: (entryId) => data.entries.find((entry) => entry.id === entryId)?.note ?? null,
    locked: data.locked,
    now: `${now.date}T${now.time}`,
  });

  const people: TimesheetPerson[] = data.people
    .map((person) => {
      const own = rows.filter((row) => row.userId === person.id);
      return {
        userId: person.id,
        fullName: person.fullName,
        rows: own,
        approvedMinutes: own
          .filter((row) => row.status === 'authorised' || row.status === 'approved')
          .reduce((sum, row) => sum + (row.times?.workedMinutes ?? 0), 0),
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  return { from: data.from, to: data.to, locked: data.locked, everyone, people };
}
