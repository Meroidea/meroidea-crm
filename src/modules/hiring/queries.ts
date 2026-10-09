import 'server-only';

import { and, desc, eq, isNull } from 'drizzle-orm';

import { departments, employeePayrollDetails, employees, employmentContracts } from '@/db/schema';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { toContractDetail } from './contract-view';
import type { EmployeeDetail, EmployeeListRow } from './types';

/** Everyone hired or offered work, newest first, each with their latest contract. */
export async function listEmployees(ctx: TenantContext): Promise<EmployeeListRow[]> {
  requirePermission(ctx, 'employees.manage');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        id: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
        email: employees.email,
        status: employees.status,
        createdAt: employees.createdAt,
        contractId: employmentContracts.id,
        contractStatus: employmentContracts.status,
        contractCreatedAt: employmentContracts.createdAt,
        employmentType: employmentContracts.employmentType,
        positionTitle: employmentContracts.positionTitle,
        startDate: employmentContracts.startDate,
      })
      .from(employees)
      .leftJoin(
        employmentContracts,
        and(
          eq(employmentContracts.tenantId, employees.tenantId),
          eq(employmentContracts.employeeId, employees.id),
          isNull(employmentContracts.deletedAt),
        ),
      )
      .where(and(eq(employees.tenantId, ctx.tenantId), isNull(employees.deletedAt)))
      .orderBy(desc(employees.createdAt), desc(employmentContracts.createdAt)),
  );

  // One row per person: the join is ordered newest contract first, so keep the first seen.
  const latest = new Map<string, EmployeeListRow>();
  for (const row of rows) {
    if (latest.has(row.id)) continue;
    latest.set(row.id, {
      id: row.id,
      fullName: `${row.firstName} ${row.lastName}`,
      email: row.email,
      status: row.status,
      contractId: row.contractId,
      contractStatus: row.contractStatus,
      employmentType: row.employmentType,
      positionTitle: row.positionTitle,
      startDate: row.startDate,
    });
  }
  return [...latest.values()];
}

export async function getEmployee(ctx: TenantContext, id: string): Promise<EmployeeDetail | null> {
  requirePermission(ctx, 'employees.manage');
  return withRls(ctx, async (tx) => {
    const [employee] = await tx
      .select()
      .from(employees)
      .where(
        and(
          eq(employees.tenantId, ctx.tenantId),
          eq(employees.id, id),
          isNull(employees.deletedAt),
        ),
      )
      .limit(1);
    if (!employee) return null;

    const history = await tx
      .select()
      .from(employmentContracts)
      .where(
        and(
          eq(employmentContracts.tenantId, ctx.tenantId),
          eq(employmentContracts.employeeId, id),
          isNull(employmentContracts.deletedAt),
        ),
      )
      .orderBy(desc(employmentContracts.createdAt));
    const contract = history[0];

    const [department] = employee.departmentId
      ? await tx
          .select({ name: departments.name })
          .from(departments)
          .where(
            and(eq(departments.tenantId, ctx.tenantId), eq(departments.id, employee.departmentId)),
          )
          .limit(1)
      : [];

    // Only the non-identifying summary is selected here; the numbers stay encrypted.
    const [payroll] = hasPermission(ctx, 'employees.view_sensitive')
      ? await tx
          .select({
            submittedAt: employeePayrollDetails.submittedAt,
            taxFileNumberCiphertext: employeePayrollDetails.taxFileNumberCiphertext,
            bankAccountName: employeePayrollDetails.bankAccountName,
            bankAccountLast3: employeePayrollDetails.bankAccountLast3,
            superFundName: employeePayrollDetails.superFundName,
          })
          .from(employeePayrollDetails)
          .where(
            and(
              eq(employeePayrollDetails.tenantId, ctx.tenantId),
              eq(employeePayrollDetails.employeeId, id),
            ),
          )
          .limit(1)
      : [];

    return {
      id: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      phone: employee.phone,
      preferredName: employee.preferredName,
      dateOfBirth: employee.dateOfBirth,
      address: employee.address,
      emergencyContactName: employee.emergencyContactName,
      emergencyContactRelationship: employee.emergencyContactRelationship,
      emergencyContactPhone: employee.emergencyContactPhone,
      departmentId: employee.departmentId,
      departmentName: department?.name ?? null,
      userId: employee.userId,
      endedOn: employee.endedOn,
      endReason: employee.endReason,
      status: employee.status,
      contract: contract ? toContractDetail(contract, employee, ctx.tenant.name) : null,
      contracts: history.map((row) => ({
        id: row.id,
        status: row.status,
        employmentType: row.employmentType,
        positionTitle: row.positionTitle,
        startDate: row.startDate,
        createdAt: row.createdAt,
      })),
      payroll: payroll
        ? {
            submittedAt: payroll.submittedAt,
            hasTaxFileNumber: Boolean(payroll.taxFileNumberCiphertext),
            bankAccountName: payroll.bankAccountName,
            bankAccountLast3: payroll.bankAccountLast3,
            superFundName: payroll.superFundName,
          }
        : null,
    };
  });
}
