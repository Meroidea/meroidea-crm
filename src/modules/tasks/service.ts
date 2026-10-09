import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { contacts, opportunities, tasks } from '@/db/schema';
import { zonedDateToInstant } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { assertCanAccess } from '@/lib/permissions/scope';
import { recordSystemActivity } from '@/modules/activities/service';
import { refreshNextTaskDue } from '@/modules/opportunities/service';
import { audit } from '@/server/audit';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import type { CreateTaskInput } from './schemas';

async function loadForWrite(tx: Tx, ctx: TenantContext, id: string) {
  const [row] = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenantId, ctx.tenantId), eq(tasks.id, id), isNull(tasks.deletedAt)))
    .limit(1)
    .for('update');
  if (!row) throw new AppError('NOT_FOUND', 'That task was not found.');
  // Task scope is about the assignee: own = assigned to me.
  assertCanAccess(ctx, 'tasks.manage', { ownerUserId: row.assignedTo });
  return row;
}

export async function createTask(
  ctx: TenantContext,
  input: CreateTaskInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'tasks.manage');
  const assignedTo = input.assignedTo ?? ctx.userId;
  if (assignedTo !== ctx.userId && !hasPermission(ctx, 'tasks.assign_others')) {
    throw new AppError('FORBIDDEN', 'You can only create tasks for yourself.', {
      assignedTo: ['Assign it to yourself'],
    });
  }

  return withRls(ctx, async (tx) => {
    let contactId = input.contactId ?? null;
    const opportunityId = input.opportunityId ?? null;
    if (opportunityId) {
      const [opportunity] = await tx
        .select({ ownerUserId: opportunities.ownerUserId, contactId: opportunities.contactId })
        .from(opportunities)
        .where(
          and(
            eq(opportunities.tenantId, ctx.tenantId),
            eq(opportunities.id, opportunityId),
            isNull(opportunities.deletedAt),
          ),
        )
        .limit(1);
      if (!opportunity) throw new AppError('NOT_FOUND', 'That record was not found.');
      assertCanAccess(ctx, 'opportunities.view', opportunity);
      contactId = contactId ?? opportunity.contactId;
    } else if (contactId) {
      const [contact] = await tx
        .select({ ownerUserId: contacts.ownerUserId })
        .from(contacts)
        .where(
          and(
            eq(contacts.tenantId, ctx.tenantId),
            eq(contacts.id, contactId),
            isNull(contacts.deletedAt),
          ),
        )
        .limit(1);
      if (!contact) throw new AppError('NOT_FOUND', 'That record was not found.');
      assertCanAccess(ctx, 'contacts.view', contact);
    }

    const [created] = await tx
      .insert(tasks)
      .values({
        tenantId: ctx.tenantId,
        title: input.title,
        type: input.type,
        priority: input.priority,
        dueAt: input.dueDate ? zonedDateToInstant(ctx.tenant.timezone, input.dueDate) : null,
        assignedTo,
        contactId,
        opportunityId,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: tasks.id });
    if (!created) throw new AppError('INTERNAL', 'Could not save the task.');

    if (opportunityId) await refreshNextTaskDue(tx, ctx, opportunityId);
    await audit(tx, ctx, { action: 'create', entityType: 'task', entityId: created.id });
    return created;
  });
}

async function setStatus(
  ctx: TenantContext,
  id: string,
  status: 'open' | 'completed' | 'cancelled',
): Promise<{ id: string }> {
  requirePermission(ctx, 'tasks.manage');
  return withRls(ctx, async (tx) => {
    const task = await loadForWrite(tx, ctx, id);
    if (task.status === status) return { id };
    const now = new Date();
    await tx
      .update(tasks)
      .set({
        status,
        completedAt: status === 'completed' ? now : null,
        completedBy: status === 'completed' ? ctx.userId : null,
        updatedBy: ctx.userId,
      })
      .where(and(eq(tasks.tenantId, ctx.tenantId), eq(tasks.id, id)));

    if (status === 'completed' && (task.contactId || task.opportunityId)) {
      await recordSystemActivity(tx, ctx, {
        type: 'task_completed',
        subject: `Completed: ${task.title}`,
        contactId: task.contactId,
        opportunityId: task.opportunityId,
        taskId: task.id,
      });
    }
    if (task.opportunityId) await refreshNextTaskDue(tx, ctx, task.opportunityId);
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'task',
      entityId: id,
      changes: { status: [task.status, status] },
    });
    return { id };
  });
}

export const completeTask = (ctx: TenantContext, id: string) => setStatus(ctx, id, 'completed');
export const reopenTask = (ctx: TenantContext, id: string) => setStatus(ctx, id, 'open');
export const cancelTask = (ctx: TenantContext, id: string) => setStatus(ctx, id, 'cancelled');
