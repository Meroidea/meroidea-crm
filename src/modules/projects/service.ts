import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { projects, projectTasks, taskTimeLogs, tenantMemberships } from '@/db/schema';
import { zonedDateTimeToInstant, zonedToday } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import type { LogTimeInput, SaveProjectInput, SaveTaskInput, TaskStatus } from './schemas';

/** A forgotten timer is cut off here rather than recording days of "work". */
const MAX_LOG_MINUTES = 1440;

async function assertMember(tx: Tx, ctx: TenantContext, userId: string | null, field: string) {
  if (!userId) return;
  const [member] = await tx
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
  if (!member) {
    throw new AppError('VALIDATION', 'Choose someone from your team.', {
      [field]: ['Choose someone from your team'],
    });
  }
}

async function findProject(tx: Tx, ctx: TenantContext, id: string) {
  const [project] = await tx
    .select({ id: projects.id, status: projects.status })
    .from(projects)
    .where(
      and(eq(projects.tenantId, ctx.tenantId), eq(projects.id, id), isNull(projects.deletedAt)),
    )
    .limit(1);
  if (!project) throw new AppError('NOT_FOUND', 'That project was not found.');
  return project;
}

async function findTask(tx: Tx, ctx: TenantContext, id: string) {
  const [task] = await tx
    .select()
    .from(projectTasks)
    .where(
      and(
        eq(projectTasks.tenantId, ctx.tenantId),
        eq(projectTasks.id, id),
        isNull(projectTasks.deletedAt),
      ),
    )
    .limit(1);
  if (!task) throw new AppError('NOT_FOUND', 'That task was not found.');
  return task;
}

export async function saveProject(
  ctx: TenantContext,
  input: SaveProjectInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'projects.manage');
  const values = {
    name: input.name,
    description: input.description,
    startsOn: input.startsOn,
    dueOn: input.dueOn,
    leadUserId: input.leadUserId,
    status: input.status,
    updatedBy: ctx.userId,
  };
  return withRls(ctx, async (tx) => {
    await assertMember(tx, ctx, input.leadUserId, 'leadUserId');
    if (input.id) {
      const project = await findProject(tx, ctx, input.id);
      await tx
        .update(projects)
        .set(values)
        .where(and(eq(projects.tenantId, ctx.tenantId), eq(projects.id, project.id)));
      await audit(tx, ctx, { action: 'update', entityType: 'project', entityId: project.id });
      return { id: project.id };
    }
    const [created] = await tx
      .insert(projects)
      .values({ tenantId: ctx.tenantId, ...values, createdBy: ctx.userId })
      .returning({ id: projects.id });
    if (!created) throw new AppError('INTERNAL', 'The project could not be saved.');
    await audit(tx, ctx, { action: 'create', entityType: 'project', entityId: created.id });
    return created;
  });
}

/** Removes a project and everything in it from view. */
export async function deleteProject(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'projects.manage');
  return withRls(ctx, async (tx) => {
    const project = await findProject(tx, ctx, id);
    const now = new Date();
    await tx
      .update(projectTasks)
      .set({ deletedAt: now, updatedBy: ctx.userId })
      .where(
        and(
          eq(projectTasks.tenantId, ctx.tenantId),
          eq(projectTasks.projectId, project.id),
          isNull(projectTasks.deletedAt),
        ),
      );
    await tx
      .update(projects)
      .set({ deletedAt: now, updatedBy: ctx.userId })
      .where(and(eq(projects.tenantId, ctx.tenantId), eq(projects.id, project.id)));
    await audit(tx, ctx, { action: 'delete', entityType: 'project', entityId: project.id });
    return { id: project.id };
  });
}

export async function saveTask(ctx: TenantContext, input: SaveTaskInput): Promise<{ id: string }> {
  requirePermission(ctx, 'projects.manage');
  const values = {
    title: input.title,
    description: input.description,
    priority: input.priority,
    assigneeUserId: input.assigneeUserId,
    dueOn: input.dueOn,
    estimateMinutes: input.estimateHours,
    updatedBy: ctx.userId,
  };
  return withRls(ctx, async (tx) => {
    const project = await findProject(tx, ctx, input.projectId);
    await assertMember(tx, ctx, input.assigneeUserId, 'assigneeUserId');
    if (input.id) {
      const task = await findTask(tx, ctx, input.id);
      if (task.projectId !== project.id)
        throw new AppError('NOT_FOUND', 'That task was not found.');
      await tx
        .update(projectTasks)
        .set(values)
        .where(and(eq(projectTasks.tenantId, ctx.tenantId), eq(projectTasks.id, task.id)));
      await audit(tx, ctx, {
        action: task.assigneeUserId === input.assigneeUserId ? 'update' : 'owner_change',
        entityType: 'project_task',
        entityId: task.id,
      });
      return { id: task.id };
    }
    const [created] = await tx
      .insert(projectTasks)
      .values({ tenantId: ctx.tenantId, projectId: project.id, ...values, createdBy: ctx.userId })
      .returning({ id: projectTasks.id });
    if (!created) throw new AppError('INTERNAL', 'The task could not be saved.');
    await audit(tx, ctx, { action: 'create', entityType: 'project_task', entityId: created.id });
    return created;
  });
}

/** Moves a task along the board. People move their own; managers move any. */
export async function setTaskStatus(
  ctx: TenantContext,
  input: { id: string; status: TaskStatus },
): Promise<{ id: string }> {
  requirePermission(ctx, 'projects.view');
  return withRls(ctx, async (tx) => {
    const task = await findTask(tx, ctx, input.id);
    if (task.assigneeUserId !== ctx.userId && !hasPermission(ctx, 'projects.manage')) {
      throw new AppError('FORBIDDEN', 'Only the person it is assigned to can move this task.');
    }
    await tx
      .update(projectTasks)
      .set({
        status: input.status,
        completedAt: input.status === 'done' ? (task.completedAt ?? new Date()) : null,
        updatedBy: ctx.userId,
      })
      .where(and(eq(projectTasks.tenantId, ctx.tenantId), eq(projectTasks.id, task.id)));
    await audit(tx, ctx, {
      action: 'stage_change',
      entityType: 'project_task',
      entityId: task.id,
      changes: { status: [task.status, input.status] },
    });
    return { id: task.id };
  });
}

export async function deleteTask(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'projects.manage');
  return withRls(ctx, async (tx) => {
    const task = await findTask(tx, ctx, id);
    await tx
      .update(projectTasks)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(projectTasks.tenantId, ctx.tenantId), eq(projectTasks.id, task.id)));
    await audit(tx, ctx, { action: 'delete', entityType: 'project_task', entityId: task.id });
    return { id: task.id };
  });
}

/** Time goes on a task by the person doing it, or by a manager helping out on it. */
function assertMayLogOn(ctx: TenantContext, task: { assigneeUserId: string | null }) {
  if (task.assigneeUserId !== ctx.userId && !hasPermission(ctx, 'projects.manage')) {
    throw new AppError('FORBIDDEN', 'You can log time on tasks assigned to you.');
  }
}

async function stopRunning(tx: Tx, ctx: TenantContext): Promise<string | null> {
  const [running] = await tx
    .select({ id: taskTimeLogs.id, startedAt: taskTimeLogs.startedAt })
    .from(taskTimeLogs)
    .where(
      and(
        eq(taskTimeLogs.tenantId, ctx.tenantId),
        eq(taskTimeLogs.userId, ctx.userId),
        isNull(taskTimeLogs.endedAt),
      ),
    )
    .limit(1);
  if (!running) return null;
  const now = new Date();
  const elapsed = Math.round((now.getTime() - running.startedAt.getTime()) / 60_000);
  await tx
    .update(taskTimeLogs)
    .set({ endedAt: now, minutes: Math.min(MAX_LOG_MINUTES, Math.max(1, elapsed)) })
    .where(and(eq(taskTimeLogs.tenantId, ctx.tenantId), eq(taskTimeLogs.id, running.id)));
  return running.id;
}

/** Starts timing a task. A timer already running elsewhere is stopped first: one at a time. */
export async function startTimer(ctx: TenantContext, taskId: string): Promise<{ id: string }> {
  requirePermission(ctx, 'projects.view');
  return withRls(ctx, async (tx) => {
    const task = await findTask(tx, ctx, taskId);
    assertMayLogOn(ctx, task);
    await stopRunning(tx, ctx);
    const [created] = await tx
      .insert(taskTimeLogs)
      .values({
        tenantId: ctx.tenantId,
        projectTaskId: task.id,
        userId: ctx.userId,
        startedAt: new Date(),
      })
      .returning({ id: taskTimeLogs.id });
    if (!created) throw new AppError('INTERNAL', 'The timer could not be started.');
    // Starting work on something that was waiting moves it along.
    if (task.status === 'todo') {
      await tx
        .update(projectTasks)
        .set({ status: 'in_progress', updatedBy: ctx.userId })
        .where(and(eq(projectTasks.tenantId, ctx.tenantId), eq(projectTasks.id, task.id)));
    }
    return created;
  });
}

export async function stopTimer(ctx: TenantContext): Promise<{ id: string }> {
  requirePermission(ctx, 'projects.view');
  return withRls(ctx, async (tx) => {
    const id = await stopRunning(tx, ctx);
    if (!id) throw new AppError('CONFLICT', 'No timer is running.');
    return { id };
  });
}

/** Records time after the fact, for work done without the timer. */
export async function logTime(ctx: TenantContext, input: LogTimeInput): Promise<{ id: string }> {
  requirePermission(ctx, 'projects.view');
  const timezone = ctx.tenant.timezone;
  if (input.date > zonedToday(timezone)) {
    throw new AppError('VALIDATION', 'Time can only be logged after it has been worked.', {
      date: ['This is in the future'],
    });
  }
  const startedAt = zonedDateTimeToInstant(timezone, input.date, '09:00');
  return withRls(ctx, async (tx) => {
    const task = await findTask(tx, ctx, input.taskId);
    assertMayLogOn(ctx, task);
    const [created] = await tx
      .insert(taskTimeLogs)
      .values({
        tenantId: ctx.tenantId,
        projectTaskId: task.id,
        userId: ctx.userId,
        startedAt,
        endedAt: new Date(startedAt.getTime() + input.hours * 60_000),
        minutes: input.hours,
        note: input.note,
      })
      .returning({ id: taskTimeLogs.id });
    if (!created) throw new AppError('INTERNAL', 'The time could not be saved.');
    return created;
  });
}
