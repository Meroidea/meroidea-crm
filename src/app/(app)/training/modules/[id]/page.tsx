import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { ModulePlayer } from '@/modules/training/components/module-player';
import { TrainingBody } from '@/modules/training/components/training-body';
import { getModuleToLearn } from '@/modules/training/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Training module' };

export default async function ModulePage({ params }: PageProps<'/training/modules/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'training.learn');
  const parsed = z.object({ id: z.uuid() }).safeParse(await params);
  const lesson = parsed.success ? await getModuleToLearn(ctx, parsed.data.id) : null;
  if (!lesson) notFound();
  const courseHref = `/training?course=${lesson.course.id}`;
  const manager = hasPermission(ctx, 'training.manage');

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Link
        href={lesson.canComplete || !manager ? courseHref : `/training/manage/${lesson.course.id}`}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> {lesson.course.title}
      </Link>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{lesson.title}</h1>
          {lesson.result?.passed && <Badge>{lesson.questions.length ? 'Passed' : 'Done'}</Badge>}
        </div>
        {lesson.result && lesson.questions.length > 0 && lesson.result.bestScore !== null && (
          <p className="text-sm text-muted-foreground">
            Best score {lesson.result.bestScore}% · {lesson.result.attempts}{' '}
            {lesson.result.attempts === 1 ? 'attempt' : 'attempts'}
          </p>
        )}
      </header>
      <TrainingBody body={lesson.body} videoUrl={lesson.videoUrl} />
      {lesson.canComplete ? (
        <ModulePlayer
          moduleId={lesson.id}
          questions={lesson.questions}
          passMark={lesson.passMark}
          alreadyPassed={lesson.result?.passed ?? false}
          nextHref={lesson.nextId ? `/training/modules/${lesson.nextId}` : null}
          courseHref={courseHref}
        />
      ) : (
        <p className="rounded-xl border bg-muted/50 p-4 text-sm text-muted-foreground">
          {lesson.course.status === 'published'
            ? 'This course is not assigned to you, so you are seeing it as a preview.'
            : 'This course is not published yet, so you are seeing it as a preview.'}{' '}
          {lesson.questions.length > 0 &&
            `It has ${lesson.questions.length} quiz ${lesson.questions.length === 1 ? 'question' : 'questions'} with a ${lesson.passMark}% pass mark.`}
        </p>
      )}
    </div>
  );
}
