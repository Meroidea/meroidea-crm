import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { DeleteModuleButton, ModuleEditor } from '@/modules/training/components/manage-tools';
import { getModuleToEdit } from '@/modules/training/queries';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Edit module' };

export default async function EditModulePage({
  params,
}: PageProps<'/training/manage/modules/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'training.manage');
  const parsed = z.object({ id: z.uuid() }).safeParse(await params);
  const lesson = parsed.success ? await getModuleToEdit(ctx, parsed.data.id) : null;
  if (!lesson) notFound();

  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <Link
        href={`/training/manage/${lesson.courseId}`}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> {lesson.courseTitle}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{lesson.title}</h1>
      <ModuleEditor
        courseId={lesson.courseId}
        moduleId={lesson.id}
        initial={{
          title: lesson.title,
          body: lesson.body,
          videoUrl: lesson.videoUrl ?? '',
          passMark: String(lesson.passMark),
          position: String(lesson.position),
          questions: lesson.questions,
        }}
      />
      <DeleteModuleButton moduleId={lesson.id} courseId={lesson.courseId} />
    </div>
  );
}
