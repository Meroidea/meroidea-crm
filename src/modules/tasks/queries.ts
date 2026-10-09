import 'server-only';

import { and, asc, count, desc, eq, gte, ilike, isNull, lt, sql, type SQL } from 'drizzle-orm';

import { contacts, opportunities, tasks, users } from '@/db/schema';
import { likePattern } from '@/lib/cursor';
import { startOfZonedDay } from '@/lib/dates';
import { scopeFilter } from '@/lib/permissions/scope';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { TaskListFilters } from './schemas';
import type { TaskRow } from './types';

/** Dates inside raw SQL need an explicit type; the driver can't infer one for a bare Date. */
const at = (date: Date) => sql`${date.toISOString()}::timestamptz`;

const columns = {
  id: tasks.id,
  title: tasks.title,
  type: tasks.type,
  status: tasks.status,
  priority: tasks.priority,
  dueAt: tasks.dueAt,
  completedAt: tasks.completedAt,
  assignedTo: tasks.assignedTo,
  assigneeName: users.fullName,
  contactId: tasks.contactId,
  contactName: contacts.fullName,
  opportunityId: tasks.opportunityId,
  opportunityName: opportunities.name,
};

/** `own` task scope means "assigned to me" (docs/permissions.md). */
function taskScope(ctx: TenantContext): SQL | undefined {
  return scopeFilter(ctx, 'tasks.view', { ownerUserId: tasks.assignedTo });
}

function windows(ctx: TenantContext) {
  const tz = ctx.tenant.timezone;
  return {
    todayStart: startOfZonedDay(tz),
    tomorrowStart: startOfZonedDay(tz, 1),
    weekEnd: startOfZonedDay(tz, 8),
  };
}

function select(ctx: TenantContext, where: SQL[], order: SQL[], limit: number) {
  return withRls(ctx, (tx) =>
    tx
      .select(columns)
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assignedTo))
      .leftJoin(
        contacts,
        and(eq(contacts.tenantId, tasks.tenantId), eq(contacts.id, tasks.contactId)),
      )
      .leftJoin(
        opportunities,
        and(eq(opportunities.tenantId, tasks.tenantId), eq(opportunities.id, tasks.opportunityId)),
      )
      .where(
        and(eq(tasks.tenantId, ctx.tenantId), isNull(tasks.deletedAt), taskScope(ctx), ...where),
      )
      .orderBy(...order)
      .limit(limit),
  );
}

export type MyDay = {
  overdue: TaskRow[];
  today: TaskRow[];
  upcoming: TaskRow[];
  noDate: TaskRow[];
  doneToday: number;
};

/** My Day: my open tasks split into overdue / today / next 7 days / undated. */
export async function getMyDay(ctx: TenantContext): Promise<MyDay> {
  requirePermission(ctx, 'tasks.view');
  const { todayStart, tomorrowStart, weekEnd } = windows(ctx);
  const mine = [eq(tasks.assignedTo, ctx.userId), eq(tasks.status, 'open')];
  const byDue = [asc(tasks.dueAt), desc(tasks.priority)];

  const [overdue, today, upcoming, noDate, done] = await Promise.all([
    select(ctx, [...mine, lt(tasks.dueAt, todayStart)], byDue, 100),
    select(
      ctx,
      [...mine, gte(tasks.dueAt, todayStart), lt(tasks.dueAt, tomorrowStart)],
      byDue,
      100,
    ),
    select(ctx, [...mine, gte(tasks.dueAt, tomorrowStart), lt(tasks.dueAt, weekEnd)], byDue, 100),
    select(ctx, [...mine, isNull(tasks.dueAt)], [desc(tasks.createdAt)], 20),
    withRls(ctx, (tx) =>
      tx
        .select({ total: count() })
        .from(tasks)
        .where(
          and(
            eq(tasks.tenantId, ctx.tenantId),
            eq(tasks.assignedTo, ctx.userId),
            eq(tasks.status, 'completed'),
            gte(tasks.completedAt, todayStart),
          ),
        ),
    ),
  ]);
  return { overdue, today, upcoming, noDate, doneToday: done[0]?.total ?? 0 };
}

export async function listTasks(ctx: TenantContext, filters: TaskListFilters): Promise<TaskRow[]> {
  requirePermission(ctx, 'tasks.view');
  const { todayStart, tomorrowStart, weekEnd } = windows(ctx);
  const where: SQL[] = [];
  if (filters.q) where.push(ilike(tasks.title, likePattern(filters.q)));
  if (filters.assignee === 'me') where.push(eq(tasks.assignedTo, ctx.userId));
  else if (filters.assignee) where.push(eq(tasks.assignedTo, filters.assignee));

  const view = filters.view ?? 'open';
  if (view === 'completed') where.push(eq(tasks.status, 'completed'));
  else where.push(eq(tasks.status, 'open'));
  if (view === 'overdue') where.push(lt(tasks.dueAt, todayStart));
  if (view === 'today') where.push(gte(tasks.dueAt, todayStart), lt(tasks.dueAt, tomorrowStart));
  if (view === 'upcoming') where.push(gte(tasks.dueAt, tomorrowStart), lt(tasks.dueAt, weekEnd));

  const order =
    view === 'completed'
      ? [desc(tasks.completedAt)]
      : [sql`${tasks.dueAt} asc nulls last`, desc(tasks.priority)];
  return select(ctx, where, order, 200);
}

export async function countTasks(
  ctx: TenantContext,
  filters: Pick<TaskListFilters, 'assignee' | 'q'>,
): Promise<Record<'open' | 'overdue' | 'today' | 'upcoming' | 'completed', number>> {
  requirePermission(ctx, 'tasks.view');
  const { todayStart, tomorrowStart, weekEnd } = windows(ctx);
  const assignee =
    filters.assignee === 'me'
      ? eq(tasks.assignedTo, ctx.userId)
      : filters.assignee
        ? eq(tasks.assignedTo, filters.assignee)
        : undefined;
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({
        open: sql<number>`count(*) filter (where ${tasks.status} = 'open')::int`,
        overdue: sql<number>`count(*) filter (where ${tasks.status} = 'open' and ${tasks.dueAt} < ${at(todayStart)})::int`,
        today: sql<number>`count(*) filter (where ${tasks.status} = 'open' and ${tasks.dueAt} >= ${at(todayStart)} and ${tasks.dueAt} < ${at(tomorrowStart)})::int`,
        upcoming: sql<number>`count(*) filter (where ${tasks.status} = 'open' and ${tasks.dueAt} >= ${at(tomorrowStart)} and ${tasks.dueAt} < ${at(weekEnd)})::int`,
        completed: sql<number>`count(*) filter (where ${tasks.status} = 'completed')::int`,
      })
      .from(tasks)
      .where(
        and(eq(tasks.tenantId, ctx.tenantId), isNull(tasks.deletedAt), taskScope(ctx), assignee),
      ),
  );
  return row ?? { open: 0, overdue: 0, today: 0, upcoming: 0, completed: 0 };
}

/** Open tasks attached to one record (its page's task panel). */
export async function listTasksFor(
  ctx: TenantContext,
  target: { contactId?: string; opportunityId?: string },
): Promise<TaskRow[]> {
  if (!ctx.grants.has('tasks.view')) return [];
  const match = target.opportunityId
    ? eq(tasks.opportunityId, target.opportunityId)
    : target.contactId
      ? eq(tasks.contactId, target.contactId)
      : undefined;
  if (!match) return [];
  return select(ctx, [match, eq(tasks.status, 'open')], [sql`${tasks.dueAt} asc nulls last`], 50);
}
