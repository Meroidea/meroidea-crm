import type { Metadata } from 'next';

import { DotBackground } from '@/components/layout/dot-background';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApplyForm } from '@/modules/recruitment/components/apply-form';
import { getPublicOpening } from '@/modules/recruitment/public';
import { JOB_TYPE_LABELS, JOB_TYPES } from '@/modules/recruitment/schemas';

export const metadata: Metadata = { title: 'Apply for this job', referrer: 'no-referrer' };

export default async function JobPage({ params }: PageProps<'/jobs/[token]'>) {
  const { token } = await params;
  const job = await getPublicOpening(token);
  const type = JOB_TYPES.find((candidate) => candidate === job?.employmentType);

  return (
    <div className="relative isolate flex min-h-svh flex-col items-center px-4 py-10">
      <DotBackground />
      <div className="flex w-full max-w-2xl flex-col gap-5">
        {!job ? (
          <Card>
            <CardHeader>
              <CardTitle>This job is not taking applications</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              It may have been filled or closed. Check with the employer for current openings.
            </CardContent>
          </Card>
        ) : (
          <>
            <header className="flex flex-col gap-2">
              <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                {job.businessName}
              </p>
              <h1 className="text-3xl font-semibold tracking-tight text-balance">{job.title}</h1>
              <div className="flex flex-wrap gap-2">
                {type && <Badge variant="secondary">{JOB_TYPE_LABELS[type]}</Badge>}
                {job.location && <Badge variant="outline">{job.location}</Badge>}
              </div>
            </header>
            <Card>
              <CardHeader>
                <CardTitle>About the job</CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-relaxed whitespace-pre-wrap">
                {job.description}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Apply</CardTitle>
              </CardHeader>
              <CardContent>
                <ApplyForm token={token} />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
