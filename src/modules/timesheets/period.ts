import 'server-only';

import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte } from 'drizzle-orm';

import { employees, rosterShifts, rosters, timeEntries, users } from '@/db/schema';
import {
  addDaysToDate,
  daysBetweenDates,
  instantToZoned,
  mondayOf,
  zonedDateToInstant,
  zonedToday,
} from '@/lib/dates';
import type { AwardPayLine, AwardWarning } from '@/modules/awards';
import { costRoster } from '@/modules/roster/insights';
import { getRosterRules, listPayRates, listRosterTeams } from '@/modules/roster/queries';
import { centsToAmount, DEFAULT_BREAK_RULES, ORDINARY_LOADINGS } from '@/modules/roster/rules';
import type { RosterRules, RosterTeam } from '@/modules/roster/types';
import { audit } from '@/server/audit';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';
import { writeWorkbook } from '@/server/xlsx';
import { toCsv } from '@/lib/csv';

import { buildTimesheetWorkbook } from './workbook';
import { matchDay, type DayEntry, type DayRow, type DayShift } from './day';

export type DayRowView = DayRow & {
  fullName: string;
  team: Pick<RosterTeam, 'name' | 'color'> | null;
  /** What the recorded time costs, and what the rostered shift would have. Null without pay access. */
  workedCents: number | null;
  rosteredCents: number | null;
  lines: AwardPayLine[];
  warnings: AwardWarning[];
};

export type PersonSummary = {
  userId: string;
  fullName: string;
  rosteredMinutes: number;
  /** Approved time only: this is what goes to pay. */
  approvedMinutes: number;
  waiting: number;
  /** Rostered shifts that have finished with no time recorded against them. */
  missing: number;
  running: number;
  /** Rostered shifts that have not been worked yet, so the period is not over for this person. */
  upcoming: number;
  costCents: number | null;
  ready: boolean;
};

export type TimesheetPeriod = {
  from: string;
  to: string;
  /** True once the period's roster has been authorised for pay: nothing can change. */
  locked: boolean;
  showCost: boolean;
  date: string;
  day: DayRowView[];
  summary: PersonSummary[];
  entries: (DayEntry & {
    fullName: string;
    cents: number | null;
    lines: AwardPayLine[];
    /** The roster team of the shift the time was worked against. */
    team: string | null;
    note: string | null;
  })[];
};

const NO_RULES: RosterRules = {
  loadings: ORDINARY_LOADINGS,
  breakRules: DEFAULT_BREAK_RULES,
  holidays: [],
};

/**
 * Everything the approval screens need for the pay period containing `date`: the roster's period
 * when a roster covers the day, otherwise that calendar week. Rostered shifts are the published
 * ones the person may see; recorded time is everyone's.
 */
export async function getTimesheetPeriod(
  ctx: TenantContext,
  date: string,
): Promise<TimesheetPeriod> {
  requirePermission(ctx, 'timesheets.manage');
  const timezone = ctx.tenant.timezone;
  const seesRoster = hasPermission(ctx, 'rosters.view');

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
              // Staff only work to a shift once it has been published to them.
              isNotNull(rosterShifts.publishedAt),
              isNotNull(rosterShifts.userId),
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
          gte(timeEntries.clockIn, start),
          lt(timeEntries.clockIn, end),
        ),
      )
      .orderBy(asc(timeEntries.clockIn));
    const userIds = [
      ...new Set([
        ...shifts.flatMap((shift) => shift.userId ?? []),
        ...entries.map((entry) => entry.userId),
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

  const [rates, rules, teams] = await Promise.all([
    listPayRates(ctx),
    seesRoster ? getRosterRules(ctx) : NO_RULES,
    seesRoster ? listRosterTeams(ctx) : [],
  ]);
  const nameOf = new Map(data.people.map((person) => [person.id, person.fullName]));
  const teamOf = new Map(teams.map((team) => [team.id, team]));
  const holidays = new Set(rules.holidays.map((holiday) => holiday.day));
  const weeks = Math.max(1, Math.round((daysBetweenDates(data.from, data.to) + 1) / 7));

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

  // Rejected time is not paid and time still running has no finish, so neither is costed.
  const payable = entries.filter((entry) => entry.endTime && entry.status !== 'rejected');
  const rosteredByUser: Record<string, Record<string, number>> = {};
  for (const shift of shifts) {
    const days = (rosteredByUser[shift.userId] ??= {});
    days[shift.date] = (days[shift.date] ?? 0) + shift.paidMinutes;
  }
  const workedCost = rates
    ? costRoster(
        payable.map((entry) => ({
          id: entry.id,
          userId: entry.userId,
          date: entry.date,
          startTime: entry.startTime,
          endTime: entry.endTime ?? entry.startTime,
          breakMinutes: entry.breakMinutes,
          paidMinutes: entry.workedMinutes,
        })),
        rates,
        rules,
        holidays,
        weeks,
        rosteredByUser,
      )
    : null;
  const rosteredCost = rates ? costRoster(shifts, rates, rules, holidays, weeks) : null;

  const day: DayRowView[] = matchDay(
    shifts.filter((shift) => shift.date === date),
    entries.filter((entry) => entry.date === date),
  )
    .map((row) => {
      const worked = row.entry ? workedCost?.get(row.entry.id) : undefined;
      const team = row.shift?.teamId ? teamOf.get(row.shift.teamId) : undefined;
      return {
        ...row,
        fullName: nameOf.get(row.userId) ?? 'Former member',
        team: team ? { name: team.name, color: team.color } : null,
        workedCents: worked?.cents ?? null,
        rosteredCents: row.shift ? (rosteredCost?.get(row.shift.id)?.cents ?? null) : null,
        lines: worked?.lines ?? [],
        warnings: worked?.warnings ?? [],
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  const today = zonedToday(timezone);
  const paired = [...new Set(shifts.map((shift) => shift.date))].flatMap((each) =>
    matchDay(
      shifts.filter((shift) => shift.date === each),
      entries.filter((entry) => entry.date === each),
    ).flatMap((row) => (row.shift && row.entry ? [{ shift: row.shift, entry: row.entry }] : [])),
  );
  const recordedShiftIds = new Set(paired.map((pair) => pair.shift.id));
  const shiftOfEntry = new Map(paired.map((pair) => [pair.entry.id, pair.shift]));
  const noteOf = new Map(data.entries.map((row) => [row.id, row.note]));
  const summary: PersonSummary[] = [...nameOf.entries()]
    .map(([userId, fullName]) => {
      const own = entries.filter((entry) => entry.userId === userId);
      const rostered = shifts.filter((shift) => shift.userId === userId);
      const approved = own.filter((entry) => entry.status === 'approved');
      const waiting = own.filter((entry) => entry.status === 'pending' && entry.endTime).length;
      const running = own.filter((entry) => !entry.endTime).length;
      const missing = rostered.filter(
        (shift) => shift.date < today && !recordedShiftIds.has(shift.id),
      ).length;
      const upcoming = rostered.filter(
        (shift) => shift.date >= today && !recordedShiftIds.has(shift.id),
      ).length;
      const cents = approved.map((entry) => workedCost?.get(entry.id)?.cents ?? null);
      return {
        userId,
        fullName,
        rosteredMinutes: rostered.reduce((sum, shift) => sum + shift.paidMinutes, 0),
        approvedMinutes: approved.reduce((sum, entry) => sum + entry.workedMinutes, 0),
        waiting,
        missing,
        running,
        upcoming,
        costCents:
          workedCost && !cents.includes(null)
            ? cents.reduce<number>((sum, value) => sum + (value ?? 0), 0)
            : null,
        ready: waiting === 0 && running === 0 && missing === 0 && upcoming === 0,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return {
    from: data.from,
    to: data.to,
    locked: data.locked,
    showCost: rates !== null,
    date,
    day,
    summary,
    entries: entries.map((entry) => ({
      ...entry,
      fullName: nameOf.get(entry.userId) ?? 'Former member',
      cents: workedCost?.get(entry.id)?.cents ?? null,
      lines: workedCost?.get(entry.id)?.lines ?? [],
      team: teamOf.get(shiftOfEntry.get(entry.id)?.teamId ?? '')?.name ?? null,
      note: noteOf.get(entry.id) ?? null,
    })),
  };
}

/**
 * The period's approved time as a CSV file: one line per stretch of work, and under an award
 * with written-down rules one line per rate it was paid at. Pay columns are left out for anyone
 * who may not see pay.
 */
export async function exportTimesheetPeriod(
  ctx: TenantContext,
  date: string,
): Promise<{ filename: string; csv: string; rows: number }> {
  requirePermission(ctx, 'timesheets.manage');
  const period = await getTimesheetPeriod(ctx, date);
  const approved = period.entries.filter((entry) => entry.status === 'approved');
  const hours = (minutes: number | null) => (minutes === null ? '' : (minutes / 60).toFixed(2));
  const rows = approved.flatMap((entry) => {
    const base = {
      Name: entry.fullName,
      Date: entry.date,
      Start: entry.startTime,
      Finish: entry.endTime ?? '',
      'Unpaid break (min)': entry.breakMinutes,
      'Hours worked': hours(entry.workedMinutes),
    };
    // The cost of the whole stretch at the person's agreed rate, repeated on each of its lines.
    const cost = { 'Cost at agreed rate': entry.cents === null ? '' : centsToAmount(entry.cents) };
    if (!period.showCost) return [base];
    if (entry.lines.length === 0) {
      return [
        {
          ...base,
          'Pay line': 'Hours at agreed rate',
          'Line hours': hours(entry.workedMinutes),
          Rate: '',
          'Award minimum': '',
          'Award clause': '',
        },
      ];
    }
    return entry.lines.map((line) => ({
      ...base,
      'Pay line': line.label,
      'Line hours': hours(line.minutes),
      Rate: line.rate,
      'Award minimum': centsToAmount(line.cents),
      'Award clause': line.clause,
      ...cost,
    }));
  });
  await withRls(ctx, (tx) =>
    audit(tx, ctx, {
      action: 'export',
      entityType: 'time_entry',
      entityId: null,
      context: {
        from: period.from,
        to: period.to,
        entries: approved.length,
        withPay: period.showCost,
      },
    }),
  );
  return {
    filename: `timesheets-${period.from}-to-${period.to}.csv`,
    csv: toCsv(rows),
    rows: approved.length,
  };
}

/**
 * The period's approved time as an Excel workbook in the familiar timesheet layout: Overview,
 * Details, By Team, By Shift Award Tag, By Comments, a sheet per day and a sheet per person.
 * Gross wage and age are included only for someone who manages employee records.
 */
export async function exportTimesheetWorkbook(
  ctx: TenantContext,
  date: string,
): Promise<{ filename: string; base64: string; rows: number }> {
  requirePermission(ctx, 'timesheets.manage');
  const period = await getTimesheetPeriod(ctx, date);
  const approved = period.entries.filter((entry) => entry.status === 'approved' && entry.endTime);
  const today = zonedToday(ctx.tenant.timezone);

  const birthdays = hasPermission(ctx, 'employees.manage')
    ? await withRls(ctx, (tx) =>
        tx
          .select({
            userId: employees.userId,
            employeeNumber: employees.employeeNumber,
            dateOfBirth: employees.dateOfBirth,
          })
          .from(employees)
          .where(
            and(
              eq(employees.tenantId, ctx.tenantId),
              isNull(employees.deletedAt),
              isNotNull(employees.userId),
            ),
          ),
      )
    : [];
  const ageOf = new Map(
    birthdays.flatMap((row) => {
      if (!row.userId || !row.dateOfBirth) return [];
      const years = Number(today.slice(0, 4)) - Number(row.dateOfBirth.slice(0, 4));
      // Not yet had this year's birthday.
      return [[row.userId, today.slice(5) < row.dateOfBirth.slice(5) ? years - 1 : years] as const];
    }),
  );

  const numberOf = new Map(
    birthdays.flatMap((row) =>
      row.userId ? [[row.userId, String(row.employeeNumber)] as const] : [],
    ),
  );

  const sheets = buildTimesheetWorkbook({
    from: period.from,
    to: period.to,
    location: ctx.tenant.name,
    currency: ctx.tenant.currency,
    people: period.summary.map((person) => ({
      userId: person.userId,
      fullName: person.fullName,
      employeeId: numberOf.get(person.userId) ?? null,
      age: ageOf.get(person.userId) ?? null,
      gross: period.showCost && person.costCents !== null ? centsToAmount(person.costCents) : null,
    })),
    entries: approved.map((entry) => ({
      userId: entry.userId,
      fullName: entry.fullName,
      date: entry.date,
      startTime: entry.startTime,
      endTime: entry.endTime ?? entry.startTime,
      breakMinutes: entry.breakMinutes,
      workedMinutes: entry.workedMinutes,
      team: entry.team,
      note: entry.note,
      lines: period.showCost ? entry.lines : [],
    })),
  });
  await withRls(ctx, (tx) =>
    audit(tx, ctx, {
      action: 'export',
      entityType: 'time_entry',
      entityId: null,
      context: {
        from: period.from,
        to: period.to,
        entries: approved.length,
        withPay: period.showCost,
        format: 'workbook',
      },
    }),
  );
  return {
    filename: `timesheets___${period.from}_${Math.floor(Date.now() / 1000)}.xlsx`,
    base64: writeWorkbook(sheets).toString('base64'),
    rows: approved.length,
  };
}
