import { ListChecks } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/data/empty-state';
import { FilterBar } from '@/components/data/filter-bar';
import { PageHeader } from '@/components/data/page-header';
import { StatusCountBar } from '@/components/data/status-count-bar';
import { withParams } from '@/components/data/url';
import { Card, CardContent } from '@/components/ui/card';
import { assignableOwners } from '@/modules/contacts/owners';
import { listActiveMembers } from '@/modules/members/queries';
import { TaskList } from '@/modules/tasks/components/task-list';
import { TaskQuickAdd } from '@/modules/tasks/components/task-quick-add';
import { countTasks, listTasks } from '@/modules/tasks/queries';
import { taskListFiltersSchema } from '@/modules/tasks/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Tasks' };

export default async function TasksPage({ searchParams }: PageProps<'/tasks'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'tasks.view');
  const filters = taskListFiltersSchema.parse(await searchParams);
  const [tasks, counts, members] = await Promise.all([
    listTasks(ctx, filters),
    countTasks(ctx, filters),
    listActiveMembers(ctx),
  ]);
  const view = filters.view ?? 'open';
  const current = { q: filters.q, view: filters.view, assignee: filters.assignee };
  const seesOthers = ctx.grants.get('tasks.view') !== 'own';
  const assignees = hasPermission(ctx, 'tasks.assign_others')
    ? assignableOwners(ctx, members, 'tasks.manage')
    : undefined;

  const items = (
    [
      ['open', 'All open', 'info'],
      ['overdue', 'Overdue', 'destructive'],
      ['today', 'Today', 'primary'],
      ['upcoming', 'Next 7 days', 'chart-3'],
      ['completed', 'Completed', 'muted'],
    ] as const
  ).map(([key, label, tone]) => ({
    key,
    label,
    count: counts[key],
    tone,
    active: view === key,
    href: withParams('/tasks', current, { view: key === 'open' ? undefined : key }),
  }));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Tasks"
        description={
          seesOthers ? 'Follow-ups across the people you work with.' : 'Everything assigned to you.'
        }
      />
      <StatusCountBar label="Tasks by status" items={items} />
      <FilterBar
        filters={current}
        searchLabel="Search tasks"
        selects={
          seesOthers
            ? [
                {
                  name: 'assignee',
                  label: 'Assignee',
                  allLabel: 'Everyone',
                  options: [
                    { value: 'me', label: 'Me' },
                    ...members
                      .filter((m) => m.userId !== ctx.userId)
                      .map((m) => ({ value: m.userId, label: m.fullName })),
                  ],
                },
              ]
            : []
        }
      />
      {hasPermission(ctx, 'tasks.manage') && (
        <TaskQuickAdd currentUserId={ctx.userId} assignees={assignees} />
      )}
      <Card>
        <CardContent>
          {tasks.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No tasks here"
              description="Add a follow-up above, or from any contact or opportunity."
            />
          ) : (
            <TaskList tasks={tasks} timezone={ctx.tenant.timezone} showAssignee={seesOthers} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
