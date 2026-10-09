import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { PageHeader } from '@/components/data/page-header';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';
import {
  DeleteApplicantButton,
  NoteForm,
  RatingStars,
  ResumeButton,
  StageSelect,
} from '@/modules/recruitment/components/recruitment-tools';
import { getApplicant } from '@/modules/recruitment/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Applicant' };

export default async function ApplicantPage({ params }: PageProps<'/recruitment/applicants/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'recruitment.manage');
  const parsed = z.object({ id: z.uuid() }).safeParse(await params);
  const applicant = parsed.success ? await getApplicant(ctx, parsed.data.id) : null;
  if (!applicant) notFound();
  const jobHref = `/recruitment/${applicant.jobOpeningId}`;
  const canHire =
    hasPermission(ctx, 'employees.manage') && ['offer', 'hired'].includes(applicant.stage);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Link
        href={jobHref}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> {applicant.jobTitle}
      </Link>
      <PageHeader
        title={applicant.fullName}
        description={`Applied ${formatDateTime(ctx, applicant.createdAt)} · ${
          applicant.source === 'website' ? 'through the apply page' : 'added by your team'
        }`}
        actions={applicant.hasResume && <ResumeButton id={applicant.id} />}
      />

      <section className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2">
        <div className="flex flex-col gap-3 text-sm" data-sensitive>
          <p>
            <span className="block text-xs text-muted-foreground">Email</span>
            <a href={`mailto:${applicant.email}`} className="underline underline-offset-4">
              {applicant.email}
            </a>
          </p>
          <p>
            <span className="block text-xs text-muted-foreground">Phone</span>
            {applicant.phone ?? '—'}
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Stage</p>
            <StageSelect id={applicant.id} stage={applicant.stage} name={applicant.fullName} />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Rating</p>
            <RatingStars id={applicant.id} rating={applicant.rating} />
          </div>
        </div>
        {applicant.coverNote && (
          <div className="sm:col-span-2">
            <p className="mb-1 text-xs text-muted-foreground">In their words</p>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{applicant.coverNote}</p>
          </div>
        )}
        {applicant.rejectionReason && (
          <p className="text-sm sm:col-span-2">
            <span className="block text-xs text-muted-foreground">Reason not progressing</span>
            {applicant.rejectionReason}
          </p>
        )}
      </section>

      {canHire && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-accent p-4">
          <p className="text-sm">
            Ready to hire? Their name and contact details carry over; you set the pay and contract
            next.
          </p>
          <Button asChild>
            <Link href={`/hiring/new?applicant=${applicant.id}`}>Start the hire</Link>
          </Button>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Notes</h2>
        <NoteForm applicantId={applicant.id} />
        {applicant.notes.length > 0 && (
          <ul className="flex flex-col divide-y rounded-xl border bg-card">
            {applicant.notes.map((note) => (
              <li key={note.id} className="px-4 py-3">
                <p className="text-sm whitespace-pre-wrap">{note.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {note.author ?? 'Someone'} · {formatDateTime(ctx, note.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex justify-end">
        <DeleteApplicantButton id={applicant.id} backTo={jobHref} />
      </div>
    </div>
  );
}
