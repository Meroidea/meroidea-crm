import { Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { cn } from '@/lib/utils';
import { ProgressBar } from '@/modules/training/components/progress-ring';
import { TeamGrid } from '@/modules/training/components/team-grid';
import { TrainingTabs } from '@/modules/training/components/training-tabs';
import { getTeamProgress } from '@/modules/training/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Staff training' };

export default async function TeamTrainingPage({ searchParams }: PageProps<'/training/team'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'training.view_all');
  const view =
    z
      .object({ view: z.enum(['people', 'averages']).optional().catch(undefined) })
      .parse(await searchParams).view ?? 'people';
  const team = await getTeamProgress(ctx);

  return (
    <div className="flex w-full max-w-6xl flex-col gap-5">
      <PageHeader
        title="Training"
        description="How much of their training each person has completed. Open someone to see each course and module."
      />
      <TrainingTabs active="team" team manage={hasPermission(ctx, 'training.manage')} />
      <nav aria-label="Staff training views" className="flex gap-2">
        {(
          [
            ['people', 'My staff', '/training/team'],
            ['averages', 'Average results', '/training/team?view=averages'],
          ] as const
        ).map(([key, label, href]) => (
          <Link
            key={key}
            href={href}
            aria-current={view === key ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-sm text-muted-foreground hover:text-foreground',
              view === key && 'border-primary bg-accent font-medium text-foreground',
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {view === 'people' ? (
        team.people.length === 0 ? (
          <div className="rounded-xl border bg-card">
            <EmptyState
              icon={Users}
              title="No staff yet"
              description="Add people in Settings → Team."
            />
          </div>
        ) : (
          <TeamGrid people={team.people} />
        )
      ) : team.courses.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={Users}
            title="No published courses"
            description="Averages appear once a course is published and assigned."
          />
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {team.courses.map((course) => (
            <li key={course.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium uppercase">{course.title}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {course.people === 0
                    ? 'Assigned to nobody'
                    : `${course.percent}% average · ${course.people} ${course.people === 1 ? 'person' : 'people'}`}
                </span>
              </div>
              <ProgressBar percent={course.people === 0 ? 0 : course.percent} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
