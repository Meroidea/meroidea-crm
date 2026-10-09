import { ArrowLeft, Globe, Paperclip } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import {
  AddApplicantButton,
  OpeningButton,
  OpeningStatusControls,
  RatingStars,
  StageSelect,
} from '@/modules/recruitment/components/recruitment-tools';
import { getOpening, listApplicants } from '@/modules/recruitment/queries';
import { JOB_TYPE_LABELS, STAGE_LABELS, STAGES } from '@/modules/recruitment/schemas';
import { requirePermission, requireTenantContext } from '@/server/context';
import { serverEnv } from '@/server/env';

export const metadata: Metadata = { title: 'Job' };

export default async function OpeningPage({ params }: PageProps<'/recruitment/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'recruitment.manage');
  const parsed = z.object({ id: z.uuid() }).safeParse(await params);
  const opening = parsed.success ? await getOpening(ctx, parsed.data.id) : null;
  if (!opening) notFound();
  const applicants = await listApplicants(ctx, opening.id);

  return (
    <div className="flex w-full flex-col gap-5">
      <Link
        href="/recruitment"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> All jobs
      </Link>
      <PageHeader
        title={opening.title}
        description={`${JOB_TYPE_LABELS[opening.employmentType]}${opening.location ? ` · ${opening.location}` : ''}`}
        actions={
          <>
            <AddApplicantButton jobOpeningId={opening.id} />
            <OpeningButton
              opening={{
                id: opening.id,
                title: opening.title,
                employmentType: opening.employmentType,
                location: opening.location ?? '',
                description: opening.description,
              }}
            />
          </>
        }
      />
      <OpeningStatusControls
        id={opening.id}
        status={opening.status}
        applyUrl={`${serverEnv().APP_URL}/jobs/${opening.publicToken}`}
      />

      {/* One column per stage; scrolls sideways on a phone. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-2">
        <div className="flex min-w-max gap-3">
          {STAGES.map((stage) => {
            const people = applicants.filter((applicant) => applicant.stage === stage);
            return (
              <section key={stage} className="flex w-64 shrink-0 flex-col gap-2">
                <h2 className="flex items-center justify-between px-1 text-sm font-medium">
                  {STAGE_LABELS[stage]}
                  <span className="text-muted-foreground tabular-nums">{people.length}</span>
                </h2>
                <ul className="flex min-h-24 flex-col gap-2 rounded-xl bg-muted/60 p-2">
                  {people.map((applicant) => (
                    <li
                      key={applicant.id}
                      className="flex flex-col gap-2 rounded-lg border bg-card p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/recruitment/applicants/${applicant.id}`}
                          className="min-w-0 font-medium underline-offset-4 hover:underline"
                          data-sensitive
                        >
                          <span className="block truncate">{applicant.fullName}</span>
                        </Link>
                        <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                          {applicant.source === 'website' && (
                            <Globe
                              aria-label="Applied through the apply page"
                              className="size-3.5"
                            />
                          )}
                          {applicant.hasResume && (
                            <Paperclip aria-label="Résumé attached" className="size-3.5" />
                          )}
                        </span>
                      </div>
                      <RatingStars id={applicant.id} rating={applicant.rating} />
                      {applicant.rejectionReason && (
                        <p className="text-xs text-muted-foreground">{applicant.rejectionReason}</p>
                      )}
                      <StageSelect
                        id={applicant.id}
                        stage={applicant.stage}
                        name={applicant.fullName}
                      />
                    </li>
                  ))}
                  {people.length === 0 && (
                    <li className="px-2 py-4 text-center text-xs text-muted-foreground">
                      Nobody here
                    </li>
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      {applicants.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <Badge variant="outline" className="mr-1.5">
            Tip
          </Badge>
          Applicants are not emailed when you move them. Contact them yourself before marking
          someone as not progressing.
        </p>
      )}
    </div>
  );
}
