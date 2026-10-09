import 'server-only';

import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';

import { projects, projectTasks, taskTimeLogs, users } from '@/db/schema';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { TaskStatus } from './schemas';

export type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'on_hold' | 'completed';
  startsOn: string | null;
  dueOn: string | null;
  leadUserId: string | null;
  leadName: string | null;
  tasks: number;
  done: number;
};

const projectColumns = {
  id: projects.id,
  name: projects.name,
  description: projects.description,
  status: projects.status,
  startsOn: projects.startsOn,
  dueOn: projects.dueOn,
  leadUserId: projects.leadUserId,
  leadName: users.fullName,
  tasks: sql<number>`(select count(*)::int from project_tasks t
    where t.tenant_id = projects.tenant_id and t.project_id = projects.id and t.deleted_at is null)`,
  done: sql<number>`(select count(*)::int from project_tasks t
    where t.tenant_id = projects.tenant_id and t.project_id = projects.id and t.deleted_at is null
      and t.status = 'done')`,
};

export async function listProjects(ctx: TenantContext): Promise<ProjectRow[]> {
  requirePermission(ctx, 'projects.view');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select(projectColumns)
      .from(projects)
      .leftJoin(users, eq(users.id, projects.leadUserId))
      .where(and(eq(projects.tenantId, ctx.tenantId), isNull(projects.deletedAt)))
      .orderBy(asc(projects.status), asc(projects.dueOn), asc(projects.name)),
  );
  return rows as ProjectRow[];
}

export async function getProject(ctx: TenantContext, id: string): Promise<ProjectRow | null> {
  requirePermission(ctx, 'projects.view');
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select(projectColumns)
      .from(projects)
      .leftJoin(users, eq(users.id, projects.leadUserId))
      .where(
        and(eq(projects.tenantId, ctx.tenantId), eq(projects.id, id), isNull(projects.deletedAt)),
      )
      .limit(1),
  );
  return (row as ProjectRow | undefined) ?? null;
}

export type TaskRow = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: 'low' | 'normal' | 'high';
  assigneeUserId: string | null;
  assigneeName: string | null;
  dueOn: string | null;
  estimateMinutes: number | null;
  /** Minutes logged that this person may see: everyone's for managers, their own otherwise. */
  loggedMinutes: number;
};

const taskColumns = {
  id: projectTasks.id,
  projectId: projectTasks.projectId,
  projectName: projects.name,
  title: projectTasks.title,
  description: projectTasks.description,
  status: projectTasks.status,
  priority: projectTasks.priority,
  assigneeUserId: projectTasks.assigneeUserId,
  assigneeName: users.fullName,
  dueOn: projectTasks.dueOn,
  estimateMinutes: projectTasks.estimateMinutes,
  loggedMinutes: sql<number>`(select coalesce(sum(l.minutes), 0)::int from task_time_logs l
    where l.tenant_id = project_tasks.tenant_id and l.project_task_id = project_tasks.id)`,
};

const taskSource = (tx: Parameters<Parameters<typeof withRls>[1]>[0]) =>
  tx
    .select(taskColumns)
    .from(projectTasks)
    .innerJoin(
      projects,
      and(eq(projects.tenantId, projectTasks.tenantId), eq(projects.id, projectTasks.projectId)),
    )
    .leftJoin(users, eq(users.id, projectTasks.assigneeUserId));

const PRIORITY_ORDER = sql`case ${projectTasks.priority} when 'high' then 0 when 'normal' then 1 else 2 end`;

export async function listProjectTasks(ctx: TenantContext, projectId: string): Promise<TaskRow[]> {
  requirePermission(ctx, 'projects.view');
  const rows = await withRls(ctx, (tx) =>
    taskSource(tx)
      .where(
        and(
          eq(projectTasks.tenantId, ctx.tenantId),
          eq(projectTasks.projectId, projectId),
          isNull(projectTasks.deletedAt),
        ),
      )
      .orderBy(PRIORITY_ORDER, asc(projectTasks.dueOn), asc(projectTasks.createdAt)),
  );
  return rows as TaskRow[];
}

/** The signed-in person's unfinished tasks, across every project that is not finished. */
export async function listMyOpenTasks(ctx: TenantContext): Promise<TaskRow[]> {
  requirePermission(ctx, 'projects.view');
  const rows = await withRls(ctx, (tx) =>
    taskSource(tx)
      .where(
        and(
          eq(projectTasks.tenantId, ctx.tenantId),
          eq(projectTasks.assigneeUserId, ctx.userId),
          ne(projectTasks.status, 'done'),
          isNull(projectTasks.deletedAt),
          isNull(projects.deletedAt),
          ne(projects.status, 'completed'),
        ),
      )
      .orderBy(asc(projectTasks.dueOn), PRIORITY_ORDER)
      .limit(100),
  );
  return rows as TaskRow[];
}

/** The task the signed-in person's timer is running on, if any. */
export async function getRunningTimer(ctx: TenantContext) {
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({
        id: taskTimeLogs.id,
        taskId: taskTimeLogs.projectTaskId,
        startedAt: taskTimeLogs.startedAt,
        taskTitle: projectTasks.title,
        projectId: projectTasks.projectId,
      })
      .from(taskTimeLogs)
      .innerJoin(
        projectTasks,
        and(
          eq(projectTasks.tenantId, taskTimeLogs.tenantId),
          eq(projectTasks.id, taskTimeLogs.projectTaskId),
        ),
      )
      .where(
        and(
          eq(taskTimeLogs.tenantId, ctx.tenantId),
          eq(taskTimeLogs.userId, ctx.userId),
          isNull(taskTimeLogs.endedAt),
        ),
      )
      .orderBy(desc(taskTimeLogs.startedAt))
      .limit(1),
  );
  return row ?? null;
}
