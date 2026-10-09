import 'server-only';

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { payslips, rosterShifts, rosters, users } from '@/db/schema';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { PayRunRoster, PayslipDetail, PayslipRow, PayslipShift } from './types';

const columns = {
  id: payslips.id,
  status: payslips.status,
  employeeId: payslips.employeeId,
  employeeName: payslips.employeeName,
  periodStart: payslips.periodStart,
  periodEnd: payslips.periodEnd,
  paymentDate: payslips.paymentDate,
  minutes: payslips.minutes,
  hourlyRate: payslips.hourlyRate,
  gross: payslips.gross,
  taxWithheld: payslips.taxWithheld,
  net: payslips.net,
  superAmount: payslips.superAmount,
  currency: payslips.currency,
};

/** Published rosters, newest first, with where each is up to in pay. */
export async function listPayRuns(ctx: TenantContext): Promise<PayRunRoster[]> {
  requirePermission(ctx, 'payroll.manage');
  return withRls(ctx, (tx) =>
    tx
      .select({
        id: rosters.id,
        startsOn: rosters.startsOn,
        endsOn: rosters.endsOn,
        status: rosters.status,
        authorisedAt: rosters.authorisedAt,
        payslips: sql<number>`(select count(*)::int from payslips p
          where p.tenant_id = rosters.tenant_id and p.roster_id = rosters.id)`,
        released: sql<number>`(select count(*)::int from payslips p
          where p.tenant_id = rosters.tenant_id and p.roster_id = rosters.id and p.status = 'released')`,
      })
      .from(rosters)
      .where(
        and(
          eq(rosters.tenantId, ctx.tenantId),
          isNull(rosters.deletedAt),
          eq(rosters.status, 'published'),
        ),
      )
      .orderBy(desc(rosters.startsOn))
      .limit(60),
  );
}

export async function getPayRun(
  ctx: TenantContext,
  rosterId: string,
): Promise<PayRunRoster | null> {
  return (await listPayRuns(ctx)).find((run) => run.id === rosterId) ?? null;
}

export async function listPayslipsForRoster(
  ctx: TenantContext,
  rosterId: string,
): Promise<PayslipRow[]> {
  requirePermission(ctx, 'payroll.manage');
  return withRls(ctx, (tx) =>
    tx
      .select(columns)
      .from(payslips)
      .where(and(eq(payslips.tenantId, ctx.tenantId), eq(payslips.rosterId, rosterId)))
      .orderBy(asc(payslips.employeeName)),
  );
}

/** The signed-in person's own payslips that have been released to them. */
export async function listMyPayslips(ctx: TenantContext): Promise<PayslipRow[]> {
  return withRls(ctx, (tx) =>
    tx
      .select(columns)
      .from(payslips)
      .where(
        and(
          eq(payslips.tenantId, ctx.tenantId),
          eq(payslips.userId, ctx.userId),
          eq(payslips.status, 'released'),
        ),
      )
      .orderBy(desc(payslips.periodStart)),
  );
}

/**
 * One payslip, for whoever runs payroll or the person it belongs to once released. Anyone else
 * gets nothing, the same as if it did not exist; the database applies the same rule.
 */
export async function getPayslip(ctx: TenantContext, id: string): Promise<PayslipDetail | null> {
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({
        ...columns,
        userId: payslips.userId,
        employerDetails: payslips.employerDetails,
        positionTitle: payslips.positionTitle,
        superRate: payslips.superRate,
        superFundName: payslips.superFundName,
        shifts: payslips.shifts,
      })
      .from(payslips)
      .where(and(eq(payslips.tenantId, ctx.tenantId), eq(payslips.id, id)))
      .limit(1),
  );
  if (!row) return null;
  const mine = row.userId === ctx.userId && row.status === 'released';
  if (!mine && !hasPermission(ctx, 'payroll.manage')) return null;
  return {
    id: row.id,
    status: row.status,
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    paymentDate: row.paymentDate,
    minutes: row.minutes,
    hourlyRate: row.hourlyRate,
    gross: row.gross,
    taxWithheld: row.taxWithheld,
    net: row.net,
    superAmount: row.superAmount,
    currency: row.currency,
    employerDetails: row.employerDetails,
    positionTitle: row.positionTitle,
    superRate: row.superRate,
    superFundName: row.superFundName,
    shifts: row.shifts as PayslipShift[],
  };
}

/** Employer details printed on the most recent payslips, to prefill the next pay run. */
export async function getLastEmployerDetails(ctx: TenantContext): Promise<string | null> {
  requirePermission(ctx, 'payroll.manage');
  const [last] = await withRls(ctx, (tx) =>
    tx
      .select({ employerDetails: payslips.employerDetails })
      .from(payslips)
      .where(eq(payslips.tenantId, ctx.tenantId))
      .orderBy(desc(payslips.createdAt))
      .limit(1),
  );
  return last?.employerDetails ?? null;
}

/**
 * People with shifts on an authorised roster who have no payslip from it: they were not linked
 * to an employee record, had no accepted contract, or are paid a salary.
 */
export async function listUnpaidPeople(ctx: TenantContext, rosterId: string): Promise<string[]> {
  requirePermission(ctx, 'payroll.manage');
  const rows = await withRls(ctx, (tx) =>
    tx
      .selectDistinct({ fullName: users.fullName })
      .from(rosterShifts)
      .innerJoin(users, eq(users.id, rosterShifts.userId))
      .where(
        and(
          eq(rosterShifts.tenantId, ctx.tenantId),
          eq(rosterShifts.rosterId, rosterId),
          isNull(rosterShifts.deletedAt),
          sql`not exists (select 1 from payslips p
            where p.tenant_id = ${ctx.tenantId} and p.roster_id = ${rosterId}
              and p.user_id = roster_shifts.user_id)`,
        ),
      )
      .orderBy(asc(users.fullName)),
  );
  return rows.map((row) => row.fullName);
}
