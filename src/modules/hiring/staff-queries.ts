import 'server-only';

import { and, asc, desc, eq, ilike, inArray, isNull, or, type SQL } from 'drizzle-orm';

import { departments, employees, employmentContracts } from '@/db/schema';
import { likePattern } from '@/lib/cursor';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { StaffFilters } from './staff-schemas';
import type { DepartmentRow, StaffRow } from './types';

/** Departments in their set order, each with how many current people are in it. */
export async function listDepartments(ctx: TenantContext): Promise<DepartmentRow[]> {
  requirePermission(ctx, 'employees.manage');
  return withRls(ctx, async (tx) => {
    const rows = await tx
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(and(eq(departments.tenantId, ctx.tenantId), isNull(departments.deletedAt)))
      .orderBy(asc(departments.position), asc(departments.name));
    const members = await tx
      .select({ departmentId: employees.departmentId })
      .from(employees)
      .where(
        and(
          eq(employees.tenantId, ctx.tenantId),
          isNull(employees.deletedAt),
          inArray(employees.status, ['active', 'pending']),
        ),
      );
    const counts = new Map<string, number>();
    for (const { departmentId } of members) {
      if (departmentId) counts.set(departmentId, (counts.get(departmentId) ?? 0) + 1);
    }
    return rows.map((row) => ({ ...row, headcount: counts.get(row.id) ?? 0 }));
  });
}

/** How many people are in each status, ignoring the status filter itself. */
export type StaffCounts = Record<'active' | 'pending' | 'ended', number>;

export async function listStaff(
  ctx: TenantContext,
  filters: StaffFilters,
): Promise<{ rows: StaffRow[]; counts: StaffCounts }> {
  requirePermission(ctx, 'employees.manage');
  const where: (SQL | undefined)[] = [
    eq(employees.tenantId, ctx.tenantId),
    isNull(employees.deletedAt),
  ];
  if (filters.q) {
    const pattern = likePattern(filters.q);
    where.push(
      or(
        ilike(employees.firstName, pattern),
        ilike(employees.lastName, pattern),
        ilike(employees.preferredName, pattern),
        ilike(employees.email, pattern),
      ),
    );
  }
  if (filters.department === 'none') where.push(isNull(employees.departmentId));
  else if (filters.department) where.push(eq(employees.departmentId, filters.department));

  const all = await withRls(ctx, (tx) =>
    tx
      .select({
        id: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
        preferredName: employees.preferredName,
        email: employees.email,
        status: employees.status,
        departmentId: employees.departmentId,
        positionTitle: employmentContracts.positionTitle,
        employmentType: employmentContracts.employmentType,
        contractStatus: employmentContracts.status,
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
      .where(and(...where))
      .orderBy(
        asc(employees.firstName),
        asc(employees.lastName),
        desc(employmentContracts.createdAt),
      ),
  );

  // One row per person: contracts arrive newest first, so the first seen is the current one.
  const people = new Map<string, StaffRow>();
  for (const row of all) {
    if (people.has(row.id)) continue;
    people.set(row.id, {
      id: row.id,
      displayName: row.preferredName ?? `${row.firstName} ${row.lastName}`,
      email: row.email,
      status: row.status,
      departmentId: row.departmentId,
      positionTitle: row.positionTitle,
      employmentType: row.employmentType,
      contractStatus: row.contractStatus,
      startDate: row.startDate,
    });
  }

  const everyone = [...people.values()];
  const counts: StaffCounts = { active: 0, pending: 0, ended: 0 };
  for (const person of everyone) counts[person.status] += 1;

  const view = filters.view ?? 'current';
  const rows = everyone.filter((person) =>
    view === 'all' ? true : view === 'current' ? person.status !== 'ended' : person.status === view,
  );
  return { rows, counts };
}
