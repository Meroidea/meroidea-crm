import 'server-only';

import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';

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
import { addDaysToDate, instantToZoned, zonedDateToInstant } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { hasFeature, hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import type { AuthoriseRosterInput } from './schemas';
import type { PayslipShift, SkippedPerson } from './types';

/**
 * Signs off a pay period and drafts a payslip for each person. The hours are either the
 * published roster's shifts or, when the business clocks in and out, the approved timesheet
 * entries that started in the roster's period. The roster's shifts are locked from this point, so a payslip always matches them.
 *
 * Gross pay is hours × the hourly rate on the person's accepted contract, and super is a
 * percentage of gross; both are worked out by the database. This does not apply award penalty
 * rates, overtime, allowances or leave, and it does not calculate tax: the amount withheld is
 * entered by whoever runs payroll before the payslips are released.
 */
export async function authoriseRoster(
  ctx: TenantContext,
  input: AuthoriseRosterInput,
): Promise<{ created: number; skipped: SkippedPerson[] }> {
  requirePermission(ctx, 'payroll.manage');
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
    for (const shift of shifts) {
      const minutes =
        Math.round((shift.endsAt.getTime() - shift.startsAt.getTime()) / 60_000) -
        shift.breakMinutes;
      const start = instantToZoned(timezone, shift.startsAt);
      const entry = worked.get(shift.userId) ?? { minutes: 0, shifts: [] };
      entry.minutes += minutes;
      entry.shifts.push({
        date: start.date,
        start: start.time,
        end: instantToZoned(timezone, shift.endsAt).time,
        minutes,
      });
      worked.set(shift.userId, entry);
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
    // Fund names are only readable with the sensitive-details permission; without it they are
    // left off the payslip rather than failing the pay run.
    const funds =
      staff.length && hasPermission(ctx, 'employees.view_sensitive')
        ? await tx
            .select({
              employeeId: employeePayrollDetails.employeeId,
              superFundName: employeePayrollDetails.superFundName,
            })
            .from(employeePayrollDetails)
            .where(eq(employeePayrollDetails.tenantId, ctx.tenantId))
        : [];

    const skipped: SkippedPerson[] = [];
    let created = 0;
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

      const gross = sql`round(${contract.payRate}::numeric * ${entry.minutes}::numeric / 60, 2)`;
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
        positionTitle: contract.positionTitle,
        minutes: entry.minutes,
        hourlyRate: contract.payRate,
        gross,
        net: gross,
        superRate: input.superRate,
        superAmount: sql`round(${gross} * ${input.superRate}::numeric / 100, 2)`,
        superFundName: funds.find((fund) => fund.employeeId === employee.id)?.superFundName ?? null,
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
      },
    });
    return { created, skipped };
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
