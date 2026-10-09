import { FolderKanban } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { zonedToday } from '@/lib/dates';
import { formatCalendarDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { listActiveMembers } from '@/modules/members/queries';
import {
  ProjectButton,
  RunningTimer,
  TaskStatusSelect,
  TaskTime,
} from '@/modules/projects/components/project-tools';
import { getRunningTimer, listMyOpenTasks, listProjects } from '@/modules/projects/queries';
import { PROJECT_STATUS_LABELS } from '@/modules/projects/schemas';
import { formatHours } from '@/modules/roster/hours';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Projects' };

const STATUS_VARIANT = { active: 'default', on_hold: 'outline', completed: 'secondary' } as const;

export default async function ProjectsPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'projects.view');
  const canManage = hasPermission(ctx, 'projects.manage');
  const today = zonedToday(ctx.tenant.timezone);
  const [projects, myTasks, timer, people] = await Promise.all([
    listProjects(ctx),
    listMyOpenTasks(ctx),
    getRunningTimer(ctx),
    canManage ? listActiveMembers(ctx) : [],
  ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Projects"
        description="Work with an end: who is doing what, by when, and how long it is taking."
        actions={canManage && <ProjectButton people={people} />}
      />
      {timer && (
        <RunningTimer
          since={timer.startedAt.getTime()}
          taskTitle={timer.taskTitle}
          projectId={timer.projectId}
        />
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">My tasks</h2>
        {myTasks.length === 0 ? (
          <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            Nothing is assigned to you right now.
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border bg-card">
            {myTasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {task.title}
                    {task.priority === 'high' && (
                      <Badge variant="destructive" className="ml-2">
                        High
                      </Badge>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <Link
                      href={`/projects/${task.projectId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {task.projectName}
                    </Link>
                    {task.dueOn && (
                      <span
                        className={cn(task.dueOn < today && 'font-medium text-destructive-text')}
                      >
                        {' · '}
                        {task.dueOn < today ? 'Overdue since' : 'Due'}{' '}
                        {formatCalendarDate(task.dueOn)}
                      </span>
                    )}
                    {task.loggedMinutes > 0 && ` · ${formatHours(task.loggedMinutes)} logged`}
                  </p>
                </div>
                <TaskTime taskId={task.id} running={timer?.taskId === task.id} today={today} />
                <div className="w-32">
                  <TaskStatusSelect id={task.id} status={task.status} title={task.title} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">All projects</h2>
        {projects.length === 0 ? (
          <div className="rounded-xl border bg-card">
            <EmptyState
              icon={FolderKanban}
              title="No projects yet"
              description={
                canManage
                  ? 'Create a project, add its tasks and assign them to your team.'
                  : 'Projects appear here once a manager creates one.'
              }
            />
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {projects.map((project) => {
              const percent = project.tasks ? Math.round((project.done / project.tasks) * 100) : 0;
              return (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    className="flex h-full flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 font-medium">{project.name}</p>
                      <Badge variant={STATUS_VARIANT[project.status]}>
                        {PROJECT_STATUS_LABELS[project.status]}
                      </Badge>
                    </div>
                    <div>
                      <div
                        role="progressbar"
                        aria-valuenow={percent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Tasks done"
                        className="h-1.5 overflow-hidden rounded-full bg-border"
                      >
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {project.done} of {project.tasks} tasks done
                        {project.dueOn && ` · due ${formatCalendarDate(project.dueOn)}`}
                        {project.leadName && ` · ${project.leadName}`}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
