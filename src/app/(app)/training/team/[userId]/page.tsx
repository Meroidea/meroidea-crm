import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { TrainingOverview } from '@/modules/training/components/training-overview';
import { getMember, getTrainingFor } from '@/modules/training/queries';
import { trainingParamsSchema } from '@/modules/training/schemas';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Individual training' };

export default async function PersonTrainingPage({
  params,
  searchParams,
}: PageProps<'/training/team/[userId]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'training.view_all');
  const parsed = z.object({ userId: z.uuid() }).safeParse(await params);
  const member = parsed.success ? await getMember(ctx, parsed.data.userId) : null;
  if (!member) notFound();
  const { course } = trainingParamsSchema.parse(await searchParams);
  const overview = await getTrainingFor(ctx, member.userId);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <Link
        href="/training/team"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> My staff
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Individual performance</h1>
      <TrainingOverview
        person={{ name: member.fullName, roleName: member.roleName }}
        overview={overview}
        selectedCourseId={course}
        courseHref={(id) => `/training/team/${member.userId}?course=${id}`}
      />
    </div>
  );
}
