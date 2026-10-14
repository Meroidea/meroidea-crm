import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ModuleEditor } from '@/modules/training/components/manage-tools';
import { getCourseToManage } from '@/modules/training/queries';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'New module' };

export default async function NewModulePage({
  params,
}: PageProps<'/training/manage/[courseId]/modules/new'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'training.manage');
  const parsed = z.object({ courseId: z.uuid() }).safeParse(await params);
  const course = parsed.success ? await getCourseToManage(ctx, parsed.data.courseId) : null;
  if (!course) notFound();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <Link
        href={`/training/manage/${course.id}`}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> {course.title}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">New module</h1>
      <ModuleEditor
        courseId={course.id}
        initial={{
          title: '',
          body: '',
          videoUrl: '',
          passMark: '80',
          position: String((course.modules.at(-1)?.position ?? 0) + 1),
          questions: [],
        }}
      />
    </div>
  );
}
