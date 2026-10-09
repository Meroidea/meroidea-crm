import 'server-only';

import { and, eq, isNull, ne, sql } from 'drizzle-orm';

import { departments, employees, tenantMemberships } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import type { EndEmploymentInput, UpdateProfileInput } from './staff-schemas';

async function assertNameFree(tx: Tx, ctx: TenantContext, name: string, exceptId?: string) {
  const [clash] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.tenantId, ctx.tenantId),
        isNull(departments.deletedAt),
        sql`lower(${departments.name}) = lower(${name})`,
        exceptId ? ne(departments.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (clash) {
    throw new AppError('CONFLICT', 'A department with that name already exists.', {
      name: ['Choose a different name'],
    });
  }
}

async function assertDepartment(tx: Tx, ctx: TenantContext, id: string) {
  const [row] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.tenantId, ctx.tenantId),
        eq(departments.id, id),
        isNull(departments.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'That department was not found.');
}

async function loadEmployee(tx: Tx, ctx: TenantContext, id: string) {
  const [row] = await tx
    .select()
    .from(employees)
    .where(
      and(eq(employees.tenantId, ctx.tenantId), eq(employees.id, id), isNull(employees.deletedAt)),
    )
    .limit(1)
    .for('update');
  if (!row) throw new AppError('NOT_FOUND', 'That person was not found.');
  return row;
}

export async function createDepartment(ctx: TenantContext, name: string): Promise<{ id: string }> {
  requirePermission(ctx, 'employees.manage');
  return withRls(ctx, async (tx) => {
    await assertNameFree(tx, ctx, name);
    const [created] = await tx
      .insert(departments)
      .values({ tenantId: ctx.tenantId, name, createdBy: ctx.userId, updatedBy: ctx.userId })
      .returning({ id: departments.id });
    if (!created) throw new AppError('INTERNAL', 'Could not create the department.');
    await audit(tx, ctx, { action: 'create', entityType: 'department', entityId: created.id });
    return created;
  });
}

export async function renameDepartment(
  ctx: TenantContext,
  input: { id: string; name: string },
): Promise<{ id: string }> {
  requirePermission(ctx, 'employees.manage');
  return withRls(ctx, async (tx) => {
    await assertDepartment(tx, ctx, input.id);
    await assertNameFree(tx, ctx, input.name, input.id);
    await tx
      .update(departments)
      .set({ name: input.name, updatedBy: ctx.userId })
      .where(and(eq(departments.tenantId, ctx.tenantId), eq(departments.id, input.id)));
    await audit(tx, ctx, { action: 'update', entityType: 'department', entityId: input.id });
    return { id: input.id };
  });
}

/** Removes a department. Its people are kept and simply become unassigned. */
export async function deleteDepartment(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'employees.manage');
  return withRls(ctx, async (tx) => {
    await assertDepartment(tx, ctx, id);
    await tx
      .update(employees)
      .set({ departmentId: null, updatedBy: ctx.userId })
      .where(and(eq(employees.tenantId, ctx.tenantId), eq(employees.departmentId, id)));
    await tx
      .update(departments)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(departments.tenantId, ctx.tenantId), eq(departments.id, id)));
    await audit(tx, ctx, { action: 'delete', entityType: 'department', entityId: id });
    return { id };
  });
}

export async function assignDepartment(
  ctx: TenantContext,
  input: { employeeId: string; departmentId: string | null },
): Promise<{ id: string }> {
  requirePermission(ctx, 'employees.manage');
  return withRls(ctx, async (tx) => {
    const employee = await loadEmployee(tx, ctx, input.employeeId);
    if (input.departmentId) await assertDepartment(tx, ctx, input.departmentId);
    if (employee.departmentId === input.departmentId) return { id: employee.id };
    await tx
      .update(employees)
      .set({ departmentId: input.departmentId, updatedBy: ctx.userId })
      .where(and(eq(employees.tenantId, ctx.tenantId), eq(employees.id, employee.id)));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'employee',
      entityId: employee.id,
      changes: { departmentId: [employee.departmentId, input.departmentId] },
    });
    return { id: employee.id };
  });
}

export async function updateEmployeeProfile(
  ctx: TenantContext,
  input: UpdateProfileInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'employees.manage');
  return withRls(ctx, async (tx) => {
    const employee = await loadEmployee(tx, ctx, input.id);
    if (input.departmentId) await assertDepartment(tx, ctx, input.departmentId);

    const { id, ...fields } = input;
    const next = { ...fields, email: fields.email.toLowerCase() };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
      (key) => (employee[key] ?? null) !== (next[key] ?? null),
    );
    if (changed.length === 0) return { id };

    await tx
      .update(employees)
      .set({ ...next, updatedBy: ctx.userId })
      .where(and(eq(employees.tenantId, ctx.tenantId), eq(employees.id, id)));
    // Which fields changed, not their values: the audit log is no place for an address or a
    // date of birth.
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'employee',
      entityId: id,
      context: { fields: changed },
    });
    return { id };
  });
}

/** Marks someone as no longer employed from a given day. Their records are kept. */
export async function endEmployment(
  ctx: TenantContext,
  input: EndEmploymentInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'employees.manage');
  return withRls(ctx, async (tx) => {
    const employee = await loadEmployee(tx, ctx, input.id);
    if (employee.status !== 'active') {
      throw new AppError(
        'CONFLICT',
        employee.status === 'ended'
          ? 'This person’s employment has already ended.'
          : 'This person has not accepted an offer yet. Withdraw the offer instead.',
      );
    }
    await tx
      .update(employees)
      .set({
        status: 'ended',
        endedOn: input.endedOn,
        endReason: input.reason,
        updatedBy: ctx.userId,
      })
      .where(and(eq(employees.tenantId, ctx.tenantId), eq(employees.id, employee.id)));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'employee',
      entityId: employee.id,
      changes: { status: ['active', 'ended'] },
      context: { endedOn: input.endedOn },
    });
    return { id: employee.id };
  });
}

/**
 * Ties an employee record to the workspace login the same person signs in with. This is what
 * lets their roster shifts be paid at their contract rate and lets them see their own payslips.
 */
export async function linkEmployeeLogin(
  ctx: TenantContext,
  input: { employeeId: string; userId: string | null },
): Promise<{ id: string }> {
  requirePermission(ctx, 'employees.manage');
  return withRls(ctx, async (tx) => {
    const employee = await loadEmployee(tx, ctx, input.employeeId);
    if (input.userId) {
      const [member] = await tx
        .select({ id: tenantMemberships.id })
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.tenantId, ctx.tenantId),
            eq(tenantMemberships.userId, input.userId),
            eq(tenantMemberships.status, 'active'),
          ),
        )
        .limit(1);
      if (!member)
        throw new AppError('NOT_FOUND', 'That login is not an active member of this workspace.');
      const [taken] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.tenantId, ctx.tenantId),
            eq(employees.userId, input.userId),
            isNull(employees.deletedAt),
            ne(employees.id, employee.id),
          ),
        )
        .limit(1);
      if (taken) {
        throw new AppError('CONFLICT', 'That login is already linked to another employee.');
      }
    }
    await tx
      .update(employees)
      .set({ userId: input.userId, updatedBy: ctx.userId })
      .where(and(eq(employees.tenantId, ctx.tenantId), eq(employees.id, employee.id)));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'employee',
      entityId: employee.id,
      changes: { userId: [employee.userId, input.userId] },
    });
    return { id: employee.id };
  });
}
