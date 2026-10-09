'use client';

import { CalendarClock, Check, Flag, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOptimistic, useTransition } from 'react';

import { cn } from '@/lib/utils';
import { completeTaskAction, reopenTaskAction } from '@/modules/tasks/actions';
import { TASK_TYPE_LABELS } from '@/modules/tasks/schemas';
import type { TaskRow } from '@/modules/tasks/types';

function dueLabel(
  due: Date | null,
  timezone: string,
): { text: string; overdue: boolean; today: boolean } {
  if (!due) return { text: 'No due date', overdue: false, today: false };
  const day = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
  const today = day(new Date());
  const dueDay = day(new Date(due));
  const tomorrow = day(new Date(Date.now() + 86_400_000));
  if (dueDay === today) return { text: 'Today', overdue: false, today: true };
  if (dueDay === tomorrow) return { text: 'Tomorrow', overdue: false, today: false };
  const text = new Intl.DateTimeFormat('en-AU', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(due));
  return { text, overdue: dueDay < today, today: false };
}

/**
 * Checkable task rows. Completing is optimistic (docs/architecture.md §4): the row ticks at
 * once and the server confirms; a failure puts it back on refresh.
 */
export function TaskList({
  tasks,
  timezone,
  showAssignee = false,
  showRecord = true,
  emptyText = 'Nothing here.',
}: {
  tasks: TaskRow[];
  timezone: string;
  showAssignee?: boolean;
  showRecord?: boolean;
  emptyText?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [optimistic, toggle] = useOptimistic(tasks, (current, id: string) =>
    current.map((task) =>
      task.id === id
        ? { ...task, status: task.status === 'open' ? ('completed' as const) : ('open' as const) }
        : task,
    ),
  );

  if (optimistic.length === 0)
    return <p className="px-1 py-4 text-sm text-muted-foreground">{emptyText}</p>;

  return (
    <ul className="flex flex-col divide-y">
      {optimistic.map((task) => {
        const due = dueLabel(task.dueAt, timezone);
        const done = task.status === 'completed';
        return (
          <li key={task.id} className="flex items-start gap-3 py-2.5">
            <button
              type="button"
              aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
              onClick={() =>
                startTransition(async () => {
                  toggle(task.id);
                  await (done
                    ? reopenTaskAction({ id: task.id })
                    : completeTaskAction({ id: task.id }));
                  router.refresh();
                })
              }
              className={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                done
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input hover:border-primary',
              )}
            >
              {done ? <Check aria-hidden className="size-3" /> : null}
            </button>
            <div className="min-w-0 flex-1">
              <p
                className={cn('text-sm font-medium', done && 'text-muted-foreground line-through')}
              >
                {task.title}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <span
                  className={cn(
                    'inline-flex items-center gap-1',
                    !done && due.overdue && 'font-medium text-destructive-text',
                    !done && due.today && 'font-medium text-primary',
                  )}
                >
                  <CalendarClock aria-hidden className="size-3" />
                  {!done && due.overdue ? `Overdue · ${due.text}` : due.text}
                </span>
                <span>{TASK_TYPE_LABELS[task.type]}</span>
                {task.priority === 'high' && (
                  <span className="inline-flex items-center gap-0.5 text-warning-text">
                    <Flag aria-hidden className="size-3" /> High
                  </span>
                )}
                {showAssignee && task.assigneeName && <span>· {task.assigneeName}</span>}
                {showRecord && task.opportunityId && (
                  <Link
                    href={`/opportunities/${task.opportunityId}`}
                    className="truncate hover:text-primary hover:underline"
                  >
                    · {task.opportunityName}
                  </Link>
                )}
                {showRecord && !task.opportunityId && task.contactId && (
                  <Link
                    href={`/contacts/${task.contactId}`}
                    className="truncate hover:text-primary hover:underline"
                  >
                    · {task.contactName}
                  </Link>
                )}
              </p>
            </div>
            {done && <RotateCcw aria-hidden className="mt-1 size-3.5 text-muted-foreground" />}
          </li>
        );
      })}
    </ul>
  );
}
