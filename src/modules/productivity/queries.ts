import 'server-only';

import { sql } from 'drizzle-orm';

import { addDaysToDate, zonedDateToInstant, zonedToday } from '@/lib/dates';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

export type ProductivityRow = {
  userId: string;
  fullName: string;
  /** Null when this viewer may not see that kind of time, or the feature is off. */
  rosteredMinutes: number | null;
  clockedMinutes: number | null;
  projectMinutes: number | null;
  tasksCompleted: number | null;
  tasksOnTime: number | null;
  tasksWithDueDate: number | null;
  tasksOverdue: number | null;
};

/**
 * What each active person did between two calendar days (in the business's timezone): hours
 * rostered, hours clocked, hours logged on project tasks, and tasks finished. Each figure is
 * only filled in when the viewer is allowed to see everyone's data of that kind, so the report
 * never shows a partial number as if it were the whole.
 */
export async function getProductivity(
  ctx: TenantContext,
  range: { from: string; to: string },
): Promise<ProductivityRow[]> {
  requirePermission(ctx, 'productivity.view');
  const timezone = ctx.tenant.timezone;
  // Raw SQL takes timestamps as text, so they are passed as ISO strings and cast.
  const start = sql`${zonedDateToInstant(timezone, range.from).toISOString()}::timestamptz`;
  const end = sql`${zonedDateToInstant(timezone, addDaysToDate(range.to, 1)).toISOString()}::timestamptz`;
  const today = zonedToday(timezone);
  const seesRoster = hasPermission(ctx, 'rosters.view_all') || hasPermission(ctx, 'rosters.manage');
  const seesClock = hasPermission(ctx, 'timesheets.manage');
  const seesProjects = hasPermission(ctx, 'projects.view');

  const rows = (await withRls(ctx, (tx) =>
    tx.execute(sql`
      select
        m.user_id as "userId",
        u.full_name as "fullName",
        (select coalesce(sum(
            greatest(0, extract(epoch from (s.ends_at - s.starts_at)) / 60 - s.break_minutes)), 0)::int
          from roster_shifts s
          join rosters r on r.tenant_id = s.tenant_id and r.id = s.roster_id
          where s.tenant_id = m.tenant_id and s.user_id = m.user_id and s.deleted_at is null
            and r.deleted_at is null and r.status = 'published'
            and s.starts_at >= ${start} and s.starts_at < ${end}) as "rosteredMinutes",
        (select coalesce(sum(
            greatest(0, extract(epoch from (e.clock_out - e.clock_in)) / 60 - e.break_minutes)), 0)::int
          from time_entries e
          where e.tenant_id = m.tenant_id and e.user_id = m.user_id and e.deleted_at is null
            and e.clock_out is not null and e.status <> 'rejected'
            and e.clock_in >= ${start} and e.clock_in < ${end}) as "clockedMinutes",
        (select coalesce(sum(l.minutes), 0)::int
          from task_time_logs l
          where l.tenant_id = m.tenant_id and l.user_id = m.user_id
            and l.started_at >= ${start} and l.started_at < ${end}) as "projectMinutes",
        (select count(*)::int from project_tasks t
          where t.tenant_id = m.tenant_id and t.assignee_user_id = m.user_id and t.deleted_at is null
            and t.completed_at >= ${start} and t.completed_at < ${end}) as "tasksCompleted",
        (select count(*)::int from project_tasks t
          where t.tenant_id = m.tenant_id and t.assignee_user_id = m.user_id and t.deleted_at is null
            and t.completed_at >= ${start} and t.completed_at < ${end}
            and t.due_on is not null) as "tasksWithDueDate",
        (select count(*)::int from project_tasks t
          where t.tenant_id = m.tenant_id and t.assignee_user_id = m.user_id and t.deleted_at is null
            and t.completed_at >= ${start} and t.completed_at < ${end}
            and t.due_on is not null
            and (t.completed_at at time zone ${timezone})::date <= t.due_on) as "tasksOnTime",
        (select count(*)::int from project_tasks t
          where t.tenant_id = m.tenant_id and t.assignee_user_id = m.user_id and t.deleted_at is null
            and t.status <> 'done' and t.due_on < ${today}::date) as "tasksOverdue"
      from tenant_memberships m
      join users u on u.id = m.user_id
      where m.tenant_id = ${ctx.tenantId} and m.status = 'active' and not m.is_support
      order by u.full_name`),
  )) as unknown as ProductivityRow[];

  return rows.map((row) => ({
    ...row,
    rosteredMinutes: seesRoster ? row.rosteredMinutes : null,
    clockedMinutes: seesClock ? row.clockedMinutes : null,
    projectMinutes: seesProjects ? row.projectMinutes : null,
    tasksCompleted: seesProjects ? row.tasksCompleted : null,
    tasksWithDueDate: seesProjects ? row.tasksWithDueDate : null,
    tasksOnTime: seesProjects ? row.tasksOnTime : null,
    tasksOverdue: seesProjects ? row.tasksOverdue : null,
  }));
}
