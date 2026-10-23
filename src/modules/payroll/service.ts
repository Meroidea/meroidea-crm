import 'server-only';

import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';

import {
  employeePayrollDetails,
  employees,
  employmentContracts,
  payslips,
  rosterShifts,
  rosters,
  timeEntries,
  users,
} from '@/db/schema';
import {
  addDaysToDate,
  daysBetweenDates,
  instantToZoned,
  zonedDateToInstant,
  zonedToday,
} from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { awardInterpreter } from '@/modules/awards';
import { dayLoadings } from '@/modules/hiring/award-rates';
import { getRosterRules } from '@/modules/roster/queries';
import { centsToAmount, ORDINARY_LOADINGS } from '@/modules/roster/rules';
import type { RosterRules } from '@/modules/roster/types';
import { employerSnapshot } from '@/modules/settings/business';
import { audit } from '@/server/audit';
import { hasFeature, hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import type { AuthoriseRosterInput } from './schemas';
import { payslipLinesFor, type WorkedShift } from './lines';
import { withholdingFor, type Withholding } from './payg';
import type { PayslipShift, SkippedPerson } from './types';

/**
 * Signs off a pay period and drafts a payslip for each person. The hours are either the
 * published roster's shifts or, when the business clocks in and out, the approved timesheet
 * entries that started in the roster's period. The roster's shifts are locked from this point, so a payslip always matches them.
 *
 * Gross pay is the sum of the pay lines (ADR-046): under an award with written-down rules, the
 * award's penalty, overtime and allowance lines; otherwise hours at the contract's rate with the
 * workspace's weekend and public-holiday loadings. Super is a percentage of ordinary time
 * earnings. Leave is not applied. Tax is worked out from the ATO's withholding formulas and the
 * person's tax file number declaration where both allow it (ADR-055); otherwise it is entered by
 * whoever runs payroll. Either way it can be corrected until the payslips are released.
 */
export async function authoriseRoster(
  ctx: TenantContext,
  input: AuthoriseRosterInput,
): Promise<{ created: number; skipped: SkippedPerson[]; taxByHand: SkippedPerson[] }> {
  requirePermission(ctx, 'payroll.manage');
  const rules: RosterRules = hasPermission(ctx, 'rosters.view')
    ? await getRosterRules(ctx)
    : { loadings: ORDINARY_LOADINGS, breakRules: [], holidays: [] };
  return withRls(ctx, async (tx) => {
    const [roster] = await tx
      .select()
      .from(rosters)
      .where(
        and(
          eq(rosters.tenantId, ctx.tenantId),
          eq(rosters.id, input.rosterId),
          isNull(rosters.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    if (!roster) throw new AppError('NOT_FOUND', 'That roster was not found.');
    if (roster.status !== 'published') {
      throw new AppError('CONFLICT', 'Publish the roster before authorising it for pay.');
    }
    if (roster.authorisedAt)
      throw new AppError('CONFLICT', 'This roster has already been authorised.');
    if (input.paymentDate < roster.startsOn) {
      throw new AppError('VALIDATION', 'The payment date is before the pay period.', {
        paymentDate: ['Choose a date on or after the period starts'],
      });
    }

    const timezone = ctx.tenant.timezone;
    const holidays = new Set(rules.holidays.map((holiday) => holiday.day));
    const weeks = Math.max(
      1,
      Math.round((daysBetweenDates(roster.startsOn, roster.endsOn) + 1) / 7),
    );
    // Anyone born after this date is under 18 today.
    const today = zonedToday(timezone);
    const adultBornBy = `${Number(today.slice(0, 4)) - 18}${today.slice(4)}`;
    const shifts =
      input.hoursFrom === 'timesheets'
        ? await approvedTimeFor(tx, ctx, roster.startsOn, roster.endsOn)
        : await tx
            .select({
              userId: rosterShifts.userId,
              startsAt: rosterShifts.startsAt,
              endsAt: rosterShifts.endsAt,
              breakMinutes: rosterShifts.breakMinutes,
            })
            .from(rosterShifts)
            .where(
              and(
                eq(rosterShifts.tenantId, ctx.tenantId),
                eq(rosterShifts.rosterId, roster.id),
                isNull(rosterShifts.deletedAt),
                // A vacant shift was never worked by anyone.
                isNotNull(rosterShifts.userId),
              ),
            )
            .orderBy(rosterShifts.startsAt);
    if (shifts.length === 0) {
      throw new AppError(
        'CONFLICT',
        input.hoursFrom === 'timesheets'
          ? 'There is no approved time in this period to pay.'
          : 'This roster has no shifts to pay.',
      );
    }

    const worked = new Map<string, { minutes: number; shifts: PayslipShift[] }>();
    const workedShifts: WorkedShift[] = [];
    for (const [index, shift] of shifts.entries()) {
      if (!shift.userId) continue;
      const minutes =
        Math.round((shift.endsAt.getTime() - shift.startsAt.getTime()) / 60_000) -
        shift.breakMinutes;
      const start = instantToZoned(timezone, shift.startsAt);
      const end = instantToZoned(timezone, shift.endsAt).time;
      const entry = worked.get(shift.userId) ?? { minutes: 0, shifts: [] };
      entry.minutes += minutes;
      entry.shifts.push({ date: start.date, start: start.time, end, minutes });
      worked.set(shift.userId, entry);
      workedShifts.push({
        id: String(index),
        userId: shift.userId,
        date: start.date,
        startTime: start.time,
        endTime: end,
        breakMinutes: shift.breakMinutes,
        paidMinutes: minutes,
      });
    }
    // When paying worked time, a part-timer's overtime turns on what they were rostered for.
    const rosteredByUser: Record<string, Record<string, number>> = {};
    if (input.hoursFrom === 'timesheets') {
      const rostered = await tx
        .select({
          userId: rosterShifts.userId,
          startsAt: rosterShifts.startsAt,
          endsAt: rosterShifts.endsAt,
          breakMinutes: rosterShifts.breakMinutes,
        })
        .from(rosterShifts)
        .where(
          and(
            eq(rosterShifts.tenantId, ctx.tenantId),
            eq(rosterShifts.rosterId, roster.id),
            isNull(rosterShifts.deletedAt),
            isNotNull(rosterShifts.userId),
          ),
        );
      for (const shift of rostered) {
        if (!shift.userId) continue;
        const days = (rosteredByUser[shift.userId] ??= {});
        const { date } = instantToZoned(timezone, shift.startsAt);
        const minutes =
          Math.round((shift.endsAt.getTime() - shift.startsAt.getTime()) / 60_000) -
          shift.breakMinutes;
        days[date] = (days[date] ?? 0) + minutes;
      }
    }
    const userIds = [...worked.keys()];

    const people = await tx
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(inArray(users.id, userIds));
    const nameOf = new Map(people.map((person) => [person.id, person.fullName]));
    const staff = await tx
      .select()
      .from(employees)
      .where(
        and(
          eq(employees.tenantId, ctx.tenantId),
          isNull(employees.deletedAt),
          inArray(employees.userId, userIds),
        ),
      );
    const contracts = staff.length
      ? await tx
          .select()
          .from(employmentContracts)
          .where(
            and(
              eq(employmentContracts.tenantId, ctx.tenantId),
              eq(employmentContracts.status, 'accepted'),
              isNull(employmentContracts.deletedAt),
              inArray(
                employmentContracts.employeeId,
                staff.map((employee) => employee.id),
              ),
            ),
          )
          .orderBy(desc(employmentContracts.acceptedAt))
      : [];
    // Fund names and tax declarations are only readable with the sensitive-details permission;
    // without it the fund is left off the payslip and the tax is entered by hand, rather than
    // failing the pay run. The tax file number itself is never read, only whether there is one.
    const canReadDetails = hasPermission(ctx, 'employees.view_sensitive');
    const details =
      staff.length && canReadDetails
        ? await tx
            .select({
              employeeId: employeePayrollDetails.employeeId,
              superFundName: employeePayrollDetails.superFundName,
              hasTaxFileNumber: sql<boolean>`${employeePayrollDetails.taxFileNumberCiphertext} is not null`,
              taxResident: employeePayrollDetails.taxResident,
              claimsTaxFreeThreshold: employeePayrollDetails.claimsTaxFreeThreshold,
              hasStudyLoan: employeePayrollDetails.hasStudyLoan,
            })
            .from(employeePayrollDetails)
            .where(
              and(
                eq(employeePayrollDetails.tenantId, ctx.tenantId),
                inArray(
                  employeePayrollDetails.employeeId,
                  staff.map((employee) => employee.id),
                ),
              ),
            )
        : [];

    const skipped: SkippedPerson[] = [];
    const taxByHand: SkippedPerson[] = [];
    let created = 0;
    let taxCalculated = 0;
    for (const userId of userIds) {
      const name = nameOf.get(userId) ?? 'Someone on the roster';
      const employee = staff.find((candidate) => candidate.userId === userId);
      if (!employee) {
        skipped.push({
          name,
          reason: 'Not linked to an employee record. Link their login on their staff profile.',
        });
        continue;
      }
      const contract = contracts.find((candidate) => candidate.employeeId === employee.id);
      if (!contract) {
        skipped.push({ name, reason: 'Has no accepted contract, so there is no pay rate.' });
        continue;
      }
      if (contract.payBasis !== 'hourly') {
        skipped.push({
          name,
          reason: 'Is paid an annual salary, which is not paid from roster hours.',
        });
        continue;
      }
      const entry = worked.get(userId);
      if (!entry) continue;

      const schedule = contract.rateSchedule;
      const pay = payslipLinesFor({
        userId,
        shifts: workedShifts,
        rates: {
          [userId]: {
            hourly: contract.payRate,
            loadings: dayLoadings(schedule?.dayRates ?? null),
            ...(schedule &&
            contract.employmentType !== 'contractor' &&
            awardInterpreter(contract.awardCode)
              ? {
                  award: {
                    code: schedule.awardCode,
                    employment: contract.employmentType,
                    schedule,
                    under18: employee.dateOfBirth ? employee.dateOfBirth > adultBornBy : false,
                  },
                }
              : {}),
          },
        },
        rules,
        holidays,
        weeks,
        ...(input.hoursFrom === 'timesheets'
          ? { rosteredMinutesByDate: rosteredByUser[userId] ?? {} }
          : {}),
      });
      const gross = centsToAmount(pay.grossCents);
      const declaration = details.find((row) => row.employeeId === employee.id) ?? null;
      const withholding: Withholding = canReadDetails
        ? withholdingFor({
            grossCents: pay.grossCents,
            weeks,
            paymentDate: input.paymentDate,
            employmentType: contract.employmentType,
            declaration,
          })
        : {
            calculated: false,
            reason:
              'Tax was not worked out, because it needs permission to see staff tax details. Enter it by hand.',
          };
      const taxCents = withholding.calculated ? withholding.cents : 0;
      if (withholding.calculated) taxCalculated += 1;
      else taxByHand.push({ name, reason: withholding.reason });
      const [{ issued = 0 } = {}] = await tx
        .select({ issued: sql<number>`count(*)::int` })
        .from(payslips)
        .where(and(eq(payslips.tenantId, ctx.tenantId), eq(payslips.employeeId, employee.id)));
      await tx.insert(payslips).values({
        tenantId: ctx.tenantId,
        rosterId: roster.id,
        employeeId: employee.id,
        userId,
        periodStart: roster.startsOn,
        periodEnd: roster.endsOn,
        paymentDate: input.paymentDate,
        employerDetails: input.employerDetails,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        employeeNumber: employee.employeeNumber,
        positionTitle: contract.positionTitle,
        minutes: entry.minutes,
        hourlyRate: contract.payRate,
        gross,
        taxWithheld: centsToAmount(taxCents),
        net: centsToAmount(pay.grossCents - taxCents),
        superRate: input.superRate,
        // Super is on ordinary time earnings, so overtime is left out of it.
        superAmount: sql`round(${centsToAmount(pay.superableCents)}::numeric * ${input.superRate}::numeric / 100, 2)`,
        number: issued + 1,
        employer: employerSnapshot(ctx.tenant),
        employmentType: contract.employmentType,
        classification: contract.classification,
        lines: pay.lines,
        superFundName: declaration?.superFundName ?? null,
        currency: contract.currency,
        shifts: entry.shifts,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      });
      created += 1;
    }

    await tx
      .update(rosters)
      .set({ authorisedAt: new Date(), authorisedBy: ctx.userId, updatedBy: ctx.userId })
      .where(and(eq(rosters.tenantId, ctx.tenantId), eq(rosters.id, roster.id)));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'roster',
      entityId: roster.id,
      context: {
        authorisedForPay: true,
        hoursFrom: input.hoursFrom,
        payslips: created,
        skipped: skipped.length,
        taxCalculated,
        taxByHand: taxByHand.length,
      },
    });
    return { created, skipped, taxByHand };
  });
}

/**
 * The approved timesheet entries that started in a pay period, in the same shape as roster
 * shifts. Refuses while anything in the period is still waiting or still running, so nobody is
 * left unpaid by an entry that was overlooked.
 */
async function approvedTimeFor(tx: Tx, ctx: TenantContext, startsOn: string, endsOn: string) {
  if (!hasFeature(ctx, 'timesheets')) {
    throw new AppError('CONFLICT', 'Timesheets are not switched on for this business.');
  }
  requirePermission(ctx, 'timesheets.manage');
  const timezone = ctx.tenant.timezone;
  const entries = await tx
    .select({
      userId: timeEntries.userId,
      startsAt: timeEntries.clockIn,
      endsAt: timeEntries.clockOut,
      breakMinutes: timeEntries.breakMinutes,
      status: timeEntries.status,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.tenantId, ctx.tenantId),
        isNull(timeEntries.deletedAt),
        gte(timeEntries.clockIn, zonedDateToInstant(timezone, startsOn)),
        lt(timeEntries.clockIn, zonedDateToInstant(timezone, addDaysToDate(endsOn, 1))),
      ),
    )
    .orderBy(timeEntries.clockIn);
  const running = entries.filter((entry) => !entry.endsAt).length;
  if (running > 0) {
    throw new AppError(
      'CONFLICT',
      `${running} ${running === 1 ? 'person is' : 'people are'} still clocked in for this period.`,
    );
  }
  const waiting = entries.filter((entry) => entry.status === 'pending').length;
  if (waiting > 0) {
    throw new AppError(
      'CONFLICT',
      `Approve or reject the ${waiting} waiting timesheet ${waiting === 1 ? 'entry' : 'entries'} in this period first.`,
    );
  }
  return entries
    .filter((entry) => entry.status === 'approved')
    .map((entry) => ({
      userId: entry.userId,
      startsAt: entry.startsAt,
      endsAt: entry.endsAt as Date,
      breakMinutes: entry.breakMinutes,
    }));
}

/** Records the tax withheld on a draft payslip; net pay follows from it. */
export async function setTaxWithheld(
  ctx: TenantContext,
  input: { id: string; taxWithheld: string },
): Promise<{ id: string }> {
  requirePermission(ctx, 'payroll.manage');
  return withRls(ctx, async (tx) => {
    const [updated] = await tx
      .update(payslips)
      .set({
        taxWithheld: input.taxWithheld,
        net: sql`${payslips.gross} - ${input.taxWithheld}::numeric`,
        updatedBy: ctx.userId,
      })
      .where(
        and(
          eq(payslips.tenantId, ctx.tenantId),
          eq(payslips.id, input.id),
          eq(payslips.status, 'draft'),
          sql`${input.taxWithheld}::numeric <= ${payslips.gross}`,
        ),
      )
      .returning({ id: payslips.id });
    if (!updated) {
      throw new AppError('VALIDATION', 'That could not be saved.', {
        taxWithheld: [
          'Tax cannot be more than gross pay, and a released payslip cannot be changed',
        ],
      });
    }
    await audit(tx, ctx, { action: 'update', entityType: 'payslip', entityId: updated.id });
    return updated;
  });
}

/** Makes a roster's draft payslips visible to the people they belong to. */
export async function releasePayslips(
  ctx: TenantContext,
  rosterId: string,
): Promise<{ released: number }> {
  requirePermission(ctx, 'payroll.manage');
  return withRls(ctx, async (tx) => {
    const released = await tx
      .update(payslips)
      .set({ status: 'released', releasedAt: new Date(), updatedBy: ctx.userId })
      .where(
        and(
          eq(payslips.tenantId, ctx.tenantId),
          eq(payslips.rosterId, rosterId),
          eq(payslips.status, 'draft'),
        ),
      )
      .returning({ id: payslips.id });
    if (released.length === 0)
      throw new AppError('CONFLICT', 'There are no draft payslips to release.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'roster',
      entityId: rosterId,
      context: { payslipsReleased: released.length },
    });
    return { released: released.length };
  });
}
