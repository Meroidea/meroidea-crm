import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { zonedToday } from '@/lib/dates';
import { formatCalendarDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { listActiveMembers } from '@/modules/members/queries';
import {
  ProjectButton,
  RunningTimer,
  TaskButton,
  TaskStatusSelect,
  TaskTime,
} from '@/modules/projects/components/project-tools';
import { getProject, getRunningTimer, listProjectTasks } from '@/modules/projects/queries';
import {
  PROJECT_STATUS_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
} from '@/modules/projects/schemas';
import { formatHours } from '@/modules/roster/hours';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Project' };

export default async function ProjectPage({ params }: PageProps<'/projects/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'projects.view');
  const canManage = hasPermission(ctx, 'projects.manage');
  const parsed = z.object({ id: z.uuid() }).safeParse(await params);
  const project = parsed.success ? await getProject(ctx, parsed.data.id) : null;
  if (!project) notFound();
  const today = zonedToday(ctx.tenant.timezone);
  const [tasks, timer, people] = await Promise.all([
    listProjectTasks(ctx, project.id),
    getRunningTimer(ctx),
    canManage ? listActiveMembers(ctx) : [],
  ]);
  const logged = tasks.reduce((sum, task) => sum + task.loggedMinutes, 0);
  const estimated = tasks.reduce((sum, task) => sum + (task.estimateMinutes ?? 0), 0);

  return (
    <div className="flex w-full flex-col gap-5">
      <Link
        href="/projects"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> All projects
      </Link>
      <PageHeader
        title={project.name}
        description={[
          PROJECT_STATUS_LABELS[project.status],
          project.dueOn && `due ${formatCalendarDate(project.dueOn)}`,
          project.leadName && `led by ${project.leadName}`,
          `${project.done} of ${project.tasks} tasks done`,
          logged > 0 &&
            `${formatHours(logged)} ${canManage ? 'logged' : 'logged by you'}${
              estimated > 0 ? ` of ${formatHours(estimated)} estimated` : ''
            }`,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          canManage && (
            <>
              <ProjectButton
                people={people}
                project={{
                  id: project.id,
                  name: project.name,
                  description: project.description ?? '',
                  startsOn: project.startsOn ?? '',
                  dueOn: project.dueOn ?? '',
                  leadUserId: project.leadUserId ?? '',
                  status: project.status,
                }}
              />
              <TaskButton projectId={project.id} people={people} />
            </>
          )
        }
      />
      {project.description && (
        <p className="max-w-3xl text-sm whitespace-pre-wrap text-muted-foreground">
          {project.description}
        </p>
      )}
      {timer && (
        <RunningTimer
          since={timer.startedAt.getTime()}
          taskTitle={timer.taskTitle}
          projectId={timer.projectId}
        />
      )}

      {/* One column per status; scrolls sideways on a phone. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-2">
        <div className="flex min-w-max gap-3">
          {TASK_STATUSES.map((status) => {
            const column = tasks.filter((task) => task.status === status);
            return (
              <section key={status} className="flex w-72 shrink-0 flex-col gap-2">
                <h2 className="flex items-center justify-between px-1 text-sm font-medium">
                  {TASK_STATUS_LABELS[status]}
                  <span className="text-muted-foreground tabular-nums">{column.length}</span>
                </h2>
                <ul className="flex min-h-24 flex-col gap-2 rounded-xl bg-muted/60 p-2">
                  {column.map((task) => {
                    const mine = task.assigneeUserId === ctx.userId;
                    const overdue = task.dueOn !== null && task.dueOn < today && status !== 'done';
                    return (
                      <li
                        key={task.id}
                        className="flex flex-col gap-2 rounded-lg border bg-card p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 text-sm font-medium">{task.title}</p>
                          {canManage && (
                            <TaskButton
                              projectId={project.id}
                              people={people}
                              task={{
                                id: task.id,
                                title: task.title,
                                description: task.description ?? '',
                                priority: task.priority,
                                assigneeUserId: task.assigneeUserId ?? '',
                                dueOn: task.dueOn ?? '',
                                estimateHours: task.estimateMinutes
                                  ? String(Number((task.estimateMinutes / 60).toFixed(2)))
                                  : '',
                              }}
                            />
                          )}
                        </div>
                        {task.description && (
                          <p className="line-clamp-3 text-xs text-muted-foreground">
                            {task.description}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          {task.priority === 'high' && <Badge variant="destructive">High</Badge>}
                          <Badge variant="secondary">{task.assigneeName ?? 'Unassigned'}</Badge>
                          {task.dueOn && (
                            <span
                              className={cn(
                                'text-muted-foreground',
                                overdue && 'font-medium text-destructive-text',
                              )}
                            >
                              {overdue ? 'Overdue' : 'Due'} {formatCalendarDate(task.dueOn)}
                            </span>
                          )}
                        </div>
                        {(task.loggedMinutes > 0 || task.estimateMinutes) && (
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {formatHours(task.loggedMinutes)} logged
                            {task.estimateMinutes
                              ? ` / ${formatHours(task.estimateMinutes)} estimated`
                              : ''}
                          </p>
                        )}
                        {(mine || canManage) && (
                          <>
                            <TaskTime
                              taskId={task.id}
                              running={timer?.taskId === task.id}
                              today={today}
                            />
                            <TaskStatusSelect
                              id={task.id}
                              status={task.status}
                              title={task.title}
                            />
                          </>
                        )}
                      </li>
                    );
                  })}
                  {column.length === 0 && (
                    <li className="px-2 py-4 text-center text-xs text-muted-foreground">
                      Nothing here
                    </li>
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
