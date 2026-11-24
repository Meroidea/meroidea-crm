import 'server-only';

import { instantToZoned } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { getRosterRules } from '@/modules/roster/queries';
import { DEFAULT_BREAK_RULES, type BreakRule } from '@/modules/roster/rules';
import { getTimesheetPeriod } from '@/modules/timesheets/period';
import { saveDayEntry } from '@/modules/timesheets/service';
import { audit } from '@/server/audit';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { TimesheetAuthoriseInput } from './schemas';
import { planAuthorisation, type AuthoriseRow } from './timesheet-planner';

/**
 * "Authorise with MeroAI" on the timesheets pay period (ADR-082). MeroAI prepares every row of the
 * period (clock times where both were recorded, else the roster's; breaks by the business's
 * rules) and the manager reviews and changes what they like. Only their "Authorise" approves
 * anything, row by row through the timesheet service, which checks permission, the pay period
 * lock, overlaps and who may approve whose time, exactly as if they had typed each row.
 */

export type TimesheetAuthorisation = {
  from: string;
  to: string;
  /** The rules the breaks came from, so the review screen can recalculate an edited row. */
  breakRules: BreakRule[];
  rows: AuthoriseRow[];
};

export async function prepareTimesheetAuthorisation(
  ctx: TenantContext,
  date: string,
): Promise<TimesheetAuthorisation> {
  requirePermission(ctx, 'ai.use');
  requirePermission(ctx, 'timesheets.manage');
  const period = await getTimesheetPeriod(ctx, date);
  if (period.locked) {
    throw new AppError(
      'CONFLICT',
      'This pay period has been authorised for pay and is locked; nothing in it can change.',
    );
  }
  const breakRules = hasPermission(ctx, 'rosters.view')
    ? (await getRosterRules(ctx)).breakRules
    : DEFAULT_BREAK_RULES;
  const now = instantToZoned(ctx.tenant.timezone, new Date());
  const rows = planAuthorisation(
    period.rows.map((row) => ({
      key: row.key,
      userId: row.userId,
      fullName: row.fullName,
      team: row.team,
      date: row.date,
      shift: row.shift
        ? { id: row.shift.id, startTime: row.shift.startTime, endTime: row.shift.endTime }
        : null,
      entry: row.entry
        ? {
            id: row.entry.id,
            startTime: row.entry.startTime,
            endTime: row.entry.endTime,
            breakMinutes: row.entry.breakMinutes,
            status: row.entry.status,
            source: row.entry.source,
          }
        : null,
      canApprove: row.canApprove,
    })),
    breakRules,
    `${now.date}T${now.time}`,
  );

  await withRls(ctx, (tx) =>
    audit(tx, ctx, {
      action: 'ai_assist',
      entityType: 'ai_assistant',
      entityId: null,
      context: {
        surface: 'timesheets',
        action: 'prepare',
        from: period.from,
        to: period.to,
        ready: rows.filter((row) => row.status === 'ready').length,
        fromClock: rows.filter((row) => row.basis === 'clock').length,
        fromRoster: rows.filter((row) => row.basis === 'roster').length,
      },
    }),
  );
  return { from: period.from, to: period.to, breakRules, rows };
}

export type TimesheetAuthoriseResult = {
  approved: number;
  skipped: { key: string; reason: string }[];
};

/**
 * The manager's final authorisation of the rows they reviewed: each one saved and approved through
 * saveDayEntry, so a row the service refuses (the period locked, a clash, someone's own time) is
 * reported back with its reason and the rest still go through.
 */
export async function authoriseTimesheets(
  ctx: TenantContext,
  input: TimesheetAuthoriseInput,
): Promise<TimesheetAuthoriseResult> {
  requirePermission(ctx, 'timesheets.manage');
  let approved = 0;
  const skipped: TimesheetAuthoriseResult['skipped'] = [];
  for (const row of input.rows) {
    try {
      await saveDayEntry(ctx, {
        entryId: row.entryId ?? undefined,
        shiftId: row.shiftId ?? undefined,
        userId: row.userId,
        date: row.date,
        start: row.start,
        end: row.end,
        breakMinutes: row.breakMinutes,
        approve: true,
      });
      approved += 1;
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      skipped.push({ key: row.key, reason: error.message });
    }
  }
  await withRls(ctx, (tx) =>
    audit(tx, ctx, {
      action: 'ai_approve',
      entityType: 'timesheets',
      entityId: null,
      context: { approved, skipped: skipped.length, edited: input.edited },
    }),
  );
  return { approved, skipped };
}
