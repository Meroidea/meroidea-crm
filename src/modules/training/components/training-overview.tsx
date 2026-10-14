import { CheckCircle2, CircleDashed, FileText, ListChecks } from 'lucide-react';
import Link from 'next/link';

import { Avatar } from '@/components/data/avatar';
import { EmptyState } from '@/components/data/empty-state';
import { cn } from '@/lib/utils';

import type { ModuleProgress, TrainingOverview as Overview } from '../queries';
import { ProgressBar, ProgressRing } from './progress-ring';

const STATUS = {
  passed: { label: 'Passed', className: 'text-primary font-semibold' },
  not_passed: { label: 'Not passed yet', className: 'text-destructive-text font-medium' },
  not_started: { label: 'To do', className: 'text-muted-foreground' },
} as const;

function statusLabel(lesson: ModuleProgress) {
  if (lesson.status === 'passed' && lesson.questions === 0) return 'Done';
  return STATUS[lesson.status].label;
}

/**
 * One person's training: their overall completion, each course's progress, and the selected
 * course's modules with status and score. The same layout for your own training and for a
 * manager looking at someone's.
 */
export function TrainingOverview({
  person,
  overview,
  selectedCourseId,
  courseHref,
  moduleHref,
}: {
  person: { name: string; roleName: string };
  overview: Overview;
  selectedCourseId: string | undefined;
  /** Where choosing a course goes, e.g. `/training?course=…`. */
  courseHref: (courseId: string) => string;
  /** Where a module opens; absent when looking at someone else's training. */
  moduleHref?: (moduleId: string) => string;
}) {
  if (overview.courses.length === 0) {
    return (
      <div className="rounded-xl border bg-card">
        <EmptyState
          icon={ListChecks}
          title="No training assigned"
          description="When training is assigned, it appears here with its progress."
        />
      </div>
    );
  }
  const selected =
    overview.courses.find((course) => course.id === selectedCourseId) ?? overview.courses[0]!;

  return (
    <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
      <aside className="flex flex-col gap-3">
        <div className="flex items-center gap-3 px-1">
          <Avatar name={person.name} className="size-11 text-sm" />
          <div className="min-w-0">
            <p className="truncate font-medium">{person.name}</p>
            <p className="truncate text-sm text-muted-foreground">{person.roleName}</p>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-col items-center gap-1 px-4 py-6">
            <ProgressRing percent={overview.percent} label="All training completed" />
            <p className="text-sm text-muted-foreground">
              {overview.passed} of {overview.total} {overview.total === 1 ? 'module' : 'modules'}{' '}
              done
            </p>
          </div>
          <nav aria-label="Courses" className="flex flex-col border-t">
            {overview.courses.map((course) => (
              <Link
                key={course.id}
                href={courseHref(course.id)}
                aria-current={course.id === selected.id ? 'true' : undefined}
                className={cn(
                  'flex flex-col gap-2 border-b px-4 py-3 text-sm transition-colors last:border-b-0 hover:bg-muted/60',
                  course.id === selected.id && 'bg-muted',
                )}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-medium uppercase">{course.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {course.percent}%
                  </span>
                </span>
                <ProgressBar percent={course.percent} />
              </Link>
            ))}
          </nav>
        </div>
      </aside>

      <section className="flex min-w-0 flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold uppercase">{selected.title}</h2>
          {selected.description && (
            <p className="mt-1 text-sm text-muted-foreground">{selected.description}</p>
          )}
        </div>
        <div className="overflow-hidden rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Module
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Status
                </th>
                <th scope="col" className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">
                  Score
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {selected.modules.map((lesson) => {
                const Icon =
                  lesson.status === 'passed'
                    ? CheckCircle2
                    : lesson.questions > 0
                      ? ListChecks
                      : lesson.status === 'not_started'
                        ? CircleDashed
                        : FileText;
                const title = (
                  <span className="flex items-center gap-2">
                    <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    {lesson.title}
                  </span>
                );
                return (
                  <tr key={lesson.id}>
                    <td className="px-4 py-3">
                      {moduleHref ? (
                        <Link
                          href={moduleHref(lesson.id)}
                          className="underline-offset-4 hover:underline"
                        >
                          {title}
                        </Link>
                      ) : (
                        title
                      )}
                    </td>
                    <td className={cn('px-4 py-3', STATUS[lesson.status].className)}>
                      {statusLabel(lesson)}
                    </td>
                    <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                      {lesson.bestScore === null ? '—' : `${lesson.bestScore}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
