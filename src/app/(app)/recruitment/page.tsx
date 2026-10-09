import { Briefcase } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/format';
import { OpeningButton } from '@/modules/recruitment/components/recruitment-tools';
import { listOpenings } from '@/modules/recruitment/queries';
import { JOB_TYPE_LABELS, OPENING_STATUS_LABELS } from '@/modules/recruitment/schemas';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Recruitment' };

const STATUS_VARIANT = { draft: 'outline', open: 'default', closed: 'secondary' } as const;

export default async function RecruitmentPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'recruitment.manage');
  const openings = await listOpenings(ctx);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <PageHeader
        title="Recruitment"
        description="Advertise a job, collect applications on its own page, and track each person through to hiring."
        actions={<OpeningButton />}
      />
      {openings.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={Briefcase}
            title="No jobs yet"
            description="Create a job to get an apply page you can share wherever you advertise."
          />
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {openings.map((opening) => (
            <li key={opening.id}>
              <Link
                href={`/recruitment/${opening.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{opening.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {JOB_TYPE_LABELS[opening.employmentType]}
                    {opening.location && ` · ${opening.location}`} · created{' '}
                    {formatDate(ctx, opening.createdAt)}
                  </p>
                </div>
                <p className="text-sm tabular-nums">
                  <span className="font-semibold">{opening.applicants}</span>{' '}
                  {opening.applicants === 1 ? 'applicant' : 'applicants'}
                  {opening.inProgress > 0 && (
                    <span className="text-muted-foreground">
                      {' '}
                      · {opening.inProgress} in progress
                    </span>
                  )}
                </p>
                <Badge variant={STATUS_VARIANT[opening.status]}>
                  {OPENING_STATUS_LABELS[opening.status]}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
