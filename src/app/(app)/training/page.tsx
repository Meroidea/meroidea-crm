import type { Metadata } from 'next';

import { PageHeader } from '@/components/data/page-header';
import { getMyName } from '@/modules/members/queries';
import { TrainingOverview } from '@/modules/training/components/training-overview';
import { TrainingTabs } from '@/modules/training/components/training-tabs';
import { getTrainingFor } from '@/modules/training/queries';
import { trainingParamsSchema } from '@/modules/training/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'My training' };

export default async function MyTrainingPage({ searchParams }: PageProps<'/training'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'training.learn');
  const { course } = trainingParamsSchema.parse(await searchParams);
  const [overview, name] = await Promise.all([getTrainingFor(ctx, ctx.userId), getMyName(ctx)]);

  return (
    <div className="flex w-full max-w-6xl flex-col gap-5">
      <PageHeader
        title="Training"
        description="The courses your business has set for you. Open a module to read it and take its quiz."
      />
      <TrainingTabs
        active="mine"
        team={hasPermission(ctx, 'training.view_all')}
        manage={hasPermission(ctx, 'training.manage')}
      />
      <TrainingOverview
        person={{ name, roleName: ctx.roleName }}
        overview={overview}
        selectedCourseId={course}
        courseHref={(id) => `/training?course=${id}`}
        moduleHref={(id) => `/training/modules/${id}`}
      />
    </div>
  );
}
