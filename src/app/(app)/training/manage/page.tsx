import { GraduationCap } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { CourseForm } from '@/modules/training/components/manage-tools';
import { TrainingTabs } from '@/modules/training/components/training-tabs';
import { listCoursesToManage } from '@/modules/training/queries';
import { COURSE_STATUS_LABELS } from '@/modules/training/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Training courses' };

const STATUS_VARIANT = { draft: 'outline', published: 'default', archived: 'secondary' } as const;

export default async function ManageTrainingPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'training.manage');
  const courses = await listCoursesToManage(ctx);

  return (
    <div className="flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Training"
        description="Write the courses your staff complete online, and decide who must do each one."
      />
      <TrainingTabs active="manage" team={hasPermission(ctx, 'training.view_all')} manage />

      {courses.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={GraduationCap}
            title="No courses yet"
            description="Start with something everyone needs, such as a welcome course with your policies, then add role-specific ones like cash handling."
          />
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {courses.map((course) => (
            <li key={course.id}>
              <Link
                href={`/training/manage/${course.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <span className="min-w-0 flex-1 basis-56">
                  <span className="block truncate font-medium">{course.title}</span>
                  <span className="block text-sm text-muted-foreground">
                    {course.modules} {course.modules === 1 ? 'module' : 'modules'} ·{' '}
                    {course.assignments === 0
                      ? 'not assigned'
                      : `${course.assignments} ${course.assignments === 1 ? 'assignment' : 'assignments'}`}
                  </span>
                </span>
                <Badge variant={STATUS_VARIANT[course.status]}>
                  {COURSE_STATUS_LABELS[course.status]}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-xl border bg-card p-5">
        <h2 className="mb-3 font-medium">New course</h2>
        <CourseForm />
      </section>
    </div>
  );
}
