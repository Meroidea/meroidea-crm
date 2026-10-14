import { ArrowLeft, ListChecks, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AssignmentEditor,
  CourseForm,
  CourseStatusControls,
} from '@/modules/training/components/manage-tools';
import { getAssignmentOptions, getCourseToManage } from '@/modules/training/queries';
import { COURSE_STATUS_LABELS } from '@/modules/training/schemas';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Training course' };

const STATUS_VARIANT = { draft: 'outline', published: 'default', archived: 'secondary' } as const;

export default async function ManageCoursePage({
  params,
}: PageProps<'/training/manage/[courseId]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'training.manage');
  const parsed = z.object({ courseId: z.uuid() }).safeParse(await params);
  const course = parsed.success ? await getCourseToManage(ctx, parsed.data.courseId) : null;
  if (!course) notFound();
  const options = await getAssignmentOptions(ctx);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <Link
        href="/training/manage"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> All courses
      </Link>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{course.title}</h1>
          <Badge variant={STATUS_VARIANT[course.status]}>
            {COURSE_STATUS_LABELS[course.status]}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {course.status === 'published'
            ? 'Staff it is assigned to can see and complete it now.'
            : course.status === 'draft'
              ? 'Only you can see it. Publish it when its modules are ready.'
              : 'Archived: it has left everyone’s training. Results are kept.'}
        </p>
        <CourseStatusControls
          courseId={course.id}
          status={course.status}
          empty={course.modules.length === 0}
        />
      </header>

      <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">Modules</h2>
          <Button asChild size="sm">
            <Link href={`/training/manage/${course.id}/modules/new`}>
              <Plus aria-hidden /> Add module
            </Link>
          </Button>
        </div>
        {course.modules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No modules yet. A module is something to read or watch, with an optional quiz.
          </p>
        ) : (
          <ol className="flex flex-col divide-y rounded-lg border">
            {course.modules.map((lesson, index) => (
              <li key={lesson.id}>
                <Link
                  href={`/training/manage/modules/${lesson.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm transition-colors hover:bg-muted/50"
                >
                  <span className="min-w-0 flex-1 basis-48 font-medium">
                    {index + 1}. {lesson.title}
                  </span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <ListChecks aria-hidden className="size-4" />
                    {lesson.questions === 0
                      ? 'Read and acknowledge'
                      : `${lesson.questions} quiz ${lesson.questions === 1 ? 'question' : 'questions'}`}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {lesson.completed} done
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <div>
          <h2 className="font-medium">Who must do it</h2>
          <p className="text-sm text-muted-foreground">
            For example everyone for a welcome course, the front of house department for cash
            handling, or the Manager role for leadership training.
          </p>
        </div>
        <AssignmentEditor courseId={course.id} assignments={course.assignments} options={options} />
      </section>

      <section className="rounded-xl border bg-card p-5">
        <h2 className="mb-3 font-medium">Course details</h2>
        <CourseForm
          course={{
            id: course.id,
            title: course.title,
            description: course.description,
            position: course.position,
          }}
        />
      </section>
    </div>
  );
}
