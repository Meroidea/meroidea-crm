import 'server-only';

import { and, eq, gte, inArray, lte, ne } from 'drizzle-orm';

import { leaveRequests, leaveTypes, tenantMemberships } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import type { DecideLeaveInput, LeaveTypeInput, RequestLeaveInput } from './schemas';

async function findRequest(tx: Tx, ctx: TenantContext, id: string) {
  const [request] = await tx
    .select({
      id: leaveRequests.id,
      userId: leaveRequests.userId,
      status: leaveRequests.status,
    })
    .from(leaveRequests)
    .where(and(eq(leaveRequests.tenantId, ctx.tenantId), eq(leaveRequests.id, id)))
    .limit(1);
  // RLS hides other people's requests, so "not yours" and "does not exist" look the same.
  if (!request) throw new AppError('NOT_FOUND', 'That request was not found.');
  return request;
}

/**
 * Asks for time away. People ask for themselves; someone who manages time off may enter leave
 * for another person (a phone call from a sick staff member), and it still waits for a decision.
 */
export async function requestLeave(
  ctx: TenantContext,
  input: RequestLeaveInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'timeoff.request');
  const userId = input.userId ?? ctx.userId;
  if (userId !== ctx.userId) requirePermission(ctx, 'timeoff.manage');

  return withRls(ctx, async (tx) => {
    const [type] = await tx
      .select({ id: leaveTypes.id })
      .from(leaveTypes)
      .where(
        and(
          eq(leaveTypes.tenantId, ctx.tenantId),
          eq(leaveTypes.id, input.leaveTypeId),
          eq(leaveTypes.isActive, true),
        ),
      )
      .limit(1);
    if (!type) {
      throw new AppError('VALIDATION', 'Choose a type of leave.', {
        leaveTypeId: ['Choose a type of leave'],
      });
    }
    if (userId !== ctx.userId) {
      const [person] = await tx
        .select({ id: tenantMemberships.id })
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.tenantId, ctx.tenantId),
            eq(tenantMemberships.userId, userId),
            eq(tenantMemberships.status, 'active'),
          ),
        )
        .limit(1);
      if (!person) throw new AppError('NOT_FOUND', 'That person was not found.');
    }

    const [clash] = await tx
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.tenantId, ctx.tenantId),
          eq(leaveRequests.userId, userId),
          inArray(leaveRequests.status, ['pending', 'approved']),
          lte(leaveRequests.startsOn, input.endsOn),
          gte(leaveRequests.endsOn, input.startsOn),
        ),
      )
      .limit(1);
    if (clash) {
      throw new AppError('CONFLICT', 'There is already a request covering some of those days.', {
        startsOn: ['These dates overlap another request'],
      });
    }

    const [created] = await tx
      .insert(leaveRequests)
      .values({
        tenantId: ctx.tenantId,
        userId,
        leaveTypeId: type.id,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        days: input.days,
        note: input.note,
        status: 'pending',
        createdBy: ctx.userId,
      })
      .returning({ id: leaveRequests.id });
    if (!created) throw new AppError('INTERNAL', 'The request could not be saved.');
    await audit(tx, ctx, { action: 'create', entityType: 'leave_request', entityId: created.id });
    return created;
  });
}

/** Approves or declines a waiting request. */
export async function decideLeave(
  ctx: TenantContext,
  input: DecideLeaveInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'timeoff.manage');
  return withRls(ctx, async (tx) => {
    const request = await findRequest(tx, ctx, input.id);
    if (request.status !== 'pending') {
      throw new AppError('CONFLICT', 'That request has already been dealt with.');
    }
    await tx
      .update(leaveRequests)
      .set({
        status: input.decision,
        decidedBy: ctx.userId,
        decidedAt: new Date(),
        decisionNote: input.note,
      })
      .where(and(eq(leaveRequests.tenantId, ctx.tenantId), eq(leaveRequests.id, request.id)));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'leave_request',
      entityId: request.id,
      changes: { status: ['pending', input.decision] },
    });
    return { id: request.id };
  });
}

/**
 * Withdraws a request. A person can withdraw their own while it is waiting; once approved, only
 * someone who manages time off can cancel it, so the roster is not surprised.
 */
export async function cancelLeave(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'timeoff.request');
  const manages = hasPermission(ctx, 'timeoff.manage');
  return withRls(ctx, async (tx) => {
    const request = await findRequest(tx, ctx, id);
    const allowed =
      request.status === 'pending' ? manages || request.userId === ctx.userId : manages;
    if (!allowed || !['pending', 'approved'].includes(request.status)) {
      throw new AppError(
        'CONFLICT',
        request.status === 'approved'
          ? 'Approved leave can only be cancelled by a manager.'
          : 'That request can no longer be cancelled.',
      );
    }
    await tx
      .update(leaveRequests)
      .set({ status: 'cancelled' })
      .where(and(eq(leaveRequests.tenantId, ctx.tenantId), eq(leaveRequests.id, request.id)));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'leave_request',
      entityId: request.id,
      changes: { status: [request.status, 'cancelled'] },
    });
    return { id: request.id };
  });
}

/** Adds a leave type, or changes one. Types in use are switched off, never deleted. */
export async function saveLeaveType(
  ctx: TenantContext,
  input: LeaveTypeInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'timeoff.manage');
  return withRls(ctx, async (tx) => {
    const [clash] = await tx
      .select({ id: leaveTypes.id })
      .from(leaveTypes)
      .where(
        and(
          eq(leaveTypes.tenantId, ctx.tenantId),
          eq(leaveTypes.name, input.name),
          input.id ? ne(leaveTypes.id, input.id) : undefined,
        ),
      )
      .limit(1);
    if (clash) {
      throw new AppError('CONFLICT', 'There is already a leave type with that name.', {
        name: ['Choose a different name'],
      });
    }
    const values = { name: input.name, isPaid: input.isPaid, isActive: input.isActive };
    const [saved] = input.id
      ? await tx
          .update(leaveTypes)
          .set(values)
          .where(and(eq(leaveTypes.tenantId, ctx.tenantId), eq(leaveTypes.id, input.id)))
          .returning({ id: leaveTypes.id })
      : await tx
          .insert(leaveTypes)
          .values({ tenantId: ctx.tenantId, createdBy: ctx.userId, ...values })
          .returning({ id: leaveTypes.id });
    if (!saved) throw new AppError('NOT_FOUND', 'That leave type was not found.');
    await audit(tx, ctx, {
      action: input.id ? 'update' : 'create',
      entityType: 'leave_type',
      entityId: saved.id,
    });
    return saved;
  });
}
