import 'server-only';

import { addDaysToDate } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { getLastEmployerDetails, getLastSuperRate } from '@/modules/payroll/queries';
import { authoriseRoster, emailReleasedPayslips, releasePayslips } from '@/modules/payroll/service';
import { getRoster, getRosterForDate } from '@/modules/roster/queries';
import { getTimesheetPeriod } from '@/modules/timesheets/period';
import { audit } from '@/server/audit';
import { isEmailConfigured } from '@/server/email';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { authoriseTimesheets, prepareTimesheetAuthorisation } from './meroai-timesheets';
import type { RunPayrollInput } from './schemas';

/**
 * MeroAI's part in pay (ADR-084), with the manager in the loop between the two steps:
 *
 * 1. From the roster, MeroAI authorises the period's timesheets (clock times, else rostered
 *    times, breaks by the rules). Nothing is locked or paid: the manager checks them in
 *    Timesheets, unauthorises and corrects any shift, and authorises it again.
 * 2. From the pay period view, when the manager is satisfied, MeroAI runs payroll from the
 *    authorised timesheets: authorises the roster for pay, drafts payslips, releases them and
 *    emails each person. It stops before releasing when a payslip's tax could not be worked out.
 */

export type RosterTimesheetResult = {
  from: string;
  to: string;
  authorised: number;
  /** Already authorised, left as they were. */
  already: number;
  /** Rows a person has to look at: rejected time, someone's own time, or a refusal. */
  needYou: number;
};

/** Step 1, from the roster page: authorise every finished shift of the roster's period. */
export async function authoriseRosterTimesheets(
  ctx: TenantContext,
  rosterId: string,
): Promise<RosterTimesheetResult> {
  requirePermission(ctx, 'ai.use');
  requirePermission(ctx, 'timesheets.manage');
  const roster = await getRoster(ctx, rosterId);
  if (!roster) throw new AppError('NOT_FOUND', 'That roster was not found.');
  if (roster.status !== 'published') {
    throw new AppError('CONFLICT', 'Publish the roster first: staff work to a published roster.');
  }
  const prepared = await prepareTimesheetAuthorisation(ctx, roster.startsOn);
  const ready = prepared.rows.filter((row) => row.status === 'ready');
  const result = ready.length
    ? await authoriseTimesheets(ctx, {
        rows: ready.map((row) => ({
          key: row.key,
          userId: row.userId,
          shiftId: row.shiftId,
          entryId: row.entryId,
          date: row.date,
          start: row.start,
          end: row.end,
          breakMinutes: row.unpaidMinutes,
        })),
        edited: 0,
      })
    : { approved: 0, skipped: [] };
  return {
    from: prepared.from,
    to: prepared.to,
    authorised: result.approved,
    already: prepared.rows.filter((row) => row.status === 'approved').length,
    needYou: prepared.rows.filter((row) => row.status === 'skip').length + result.skipped.length,
  };
}

export type PayrollPreview = {
  rosterId: string;
  from: string;
  to: string;
  people: number;
  authorisedMinutes: number;
  /** What the authorised time costs; null without pay access or an unpriced person. */
  costCents: number | null;
  /** Rostered shifts with no time: not paid. */
  unpaidShifts: number;
  /** Why payroll cannot run yet, in words; empty when it can. */
  blockers: string[];
  defaults: { paymentDate: string; superRate: string; employerDetails: string };
  emailConfigured: boolean;
};

/** What "Run payroll with MeroAI" would pay, for the confirmation on the pay period view. */
export async function payrollPreview(
  ctx: TenantContext,
  date: string,
): Promise<PayrollPreview | null> {
  requirePermission(ctx, 'payroll.manage');
  const period = await getTimesheetPeriod(ctx, date);
  if (period.locked) return null;
  const roster = await getRosterForDate(ctx, period.from);
  if (!roster || roster.startsOn !== period.from) return null;
  const summary = period.summary;
  const sum = (pick: (person: (typeof summary)[number]) => number) =>
    summary.reduce((total, person) => total + pick(person), 0);
  const blockers = [
    roster.status !== 'published' && 'The roster is not published.',
    sum((person) => person.waiting) > 0 &&
      `${sum((person) => person.waiting)} timesheets are waiting to be authorised.`,
    sum((person) => person.running) > 0 &&
      `${sum((person) => person.running)} people are still clocked in.`,
    sum((person) => person.upcoming) > 0 &&
      `${sum((person) => person.upcoming)} rostered shifts have not been worked yet.`,
    sum((person) => person.approvedMinutes) === 0 && 'Nothing has been authorised yet.',
  ].filter((item): item is string => Boolean(item));
  const costs = summary.filter((person) => person.approvedMinutes > 0).map((p) => p.costCents);
  const [employerDetails, superRate] = await Promise.all([
    getLastEmployerDetails(ctx),
    getLastSuperRate(ctx),
  ]);
  return {
    rosterId: roster.id,
    from: period.from,
    to: period.to,
    people: summary.filter((person) => person.approvedMinutes > 0).length,
    authorisedMinutes: sum((person) => person.approvedMinutes),
    costCents:
      period.showCost && !costs.includes(null)
        ? costs.reduce<number>((total, cents) => total + (cents ?? 0), 0)
        : null,
    unpaidShifts: sum((person) => person.missing),
    blockers,
    defaults: {
      paymentDate: addDaysToDate(period.to, 3),
      superRate: superRate ?? '12',
      employerDetails: employerDetails ?? ctx.tenant.name,
    },
    emailConfigured: isEmailConfigured(),
  };
}

export type RunPayrollResult = {
  rosterId: string;
  created: number;
  skipped: { name: string; reason: string }[];
  /** Payslips whose tax must be entered by hand: payroll stopped before releasing. */
  taxByHand: { name: string; reason: string }[];
  released: number;
  emailed: number;
  emailConfigured: boolean;
};

/**
 * Step 2, from the pay period view: payroll from the authorised timesheets, on the manager's
 * confirmation. Each step is the Payroll screen's own service, with its own checks and audit.
 */
export async function runPayrollWithMeroAI(
  ctx: TenantContext,
  input: RunPayrollInput,
): Promise<RunPayrollResult> {
  requirePermission(ctx, 'ai.use');
  requirePermission(ctx, 'payroll.manage');
  requirePermission(ctx, 'timesheets.manage');
  const preview = await payrollPreview(ctx, input.date);
  if (!preview) {
    throw new AppError(
      'CONFLICT',
      'This pay period has already been paid, or no published roster covers it.',
    );
  }
  if (preview.blockers.length) {
    throw new AppError('CONFLICT', `Payroll cannot run yet. ${preview.blockers.join(' ')}`);
  }

  const authorised = await authoriseRoster(ctx, {
    rosterId: preview.rosterId,
    paymentDate: input.paymentDate,
    superRate: input.superRate,
    employerDetails: input.employerDetails,
    hoursFrom: 'timesheets',
  });
  let released = 0;
  let emailed = 0;
  let emailConfigured = isEmailConfigured();
  // A payslip with tax still to enter must not be released at $0 tax: hand over to Payroll.
  if (authorised.taxByHand.length === 0 && authorised.created > 0) {
    released = (await releasePayslips(ctx, preview.rosterId)).released;
    ({ emailed, emailConfigured } = await emailReleasedPayslips(ctx, preview.rosterId));
  }

  await withRls(ctx, (tx) =>
    audit(tx, ctx, {
      action: 'ai_assist',
      entityType: 'ai_assistant',
      entityId: preview.rosterId,
      context: {
        surface: 'payroll',
        action: 'run',
        created: authorised.created,
        skipped: authorised.skipped.length,
        taxByHand: authorised.taxByHand.length,
        released,
        emailed,
      },
    }),
  );
  return {
    rosterId: preview.rosterId,
    created: authorised.created,
    skipped: authorised.skipped,
    taxByHand: authorised.taxByHand,
    released,
    emailed,
    emailConfigured,
  };
}
