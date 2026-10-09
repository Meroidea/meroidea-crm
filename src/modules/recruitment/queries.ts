import 'server-only';

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { applicantNotes, jobApplicants, jobOpenings, users } from '@/db/schema';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { OpeningStatus, Stage } from './schemas';

export type OpeningRow = {
  id: string;
  title: string;
  employmentType: 'casual' | 'part_time' | 'full_time' | 'contract';
  location: string | null;
  description: string;
  status: OpeningStatus;
  publicToken: string;
  createdAt: Date;
  applicants: number;
  inProgress: number;
};

const openingColumns = {
  id: jobOpenings.id,
  title: jobOpenings.title,
  employmentType: jobOpenings.employmentType,
  location: jobOpenings.location,
  description: jobOpenings.description,
  status: jobOpenings.status,
  publicToken: jobOpenings.publicToken,
  createdAt: jobOpenings.createdAt,
  applicants: sql<number>`(select count(*)::int from job_applicants a
    where a.tenant_id = job_openings.tenant_id and a.job_opening_id = job_openings.id
      and a.deleted_at is null)`,
  inProgress: sql<number>`(select count(*)::int from job_applicants a
    where a.tenant_id = job_openings.tenant_id and a.job_opening_id = job_openings.id
      and a.deleted_at is null and a.stage not in ('hired', 'rejected'))`,
};

export async function listOpenings(ctx: TenantContext): Promise<OpeningRow[]> {
  requirePermission(ctx, 'recruitment.manage');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select(openingColumns)
      .from(jobOpenings)
      .where(and(eq(jobOpenings.tenantId, ctx.tenantId), isNull(jobOpenings.deletedAt)))
      .orderBy(asc(jobOpenings.status), desc(jobOpenings.createdAt)),
  );
  return rows as OpeningRow[];
}

export async function getOpening(ctx: TenantContext, id: string): Promise<OpeningRow | null> {
  requirePermission(ctx, 'recruitment.manage');
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select(openingColumns)
      .from(jobOpenings)
      .where(
        and(
          eq(jobOpenings.tenantId, ctx.tenantId),
          eq(jobOpenings.id, id),
          isNull(jobOpenings.deletedAt),
        ),
      )
      .limit(1),
  );
  return (row as OpeningRow | undefined) ?? null;
}

export type ApplicantRow = {
  id: string;
  jobOpeningId: string;
  fullName: string;
  email: string;
  phone: string | null;
  coverNote: string | null;
  hasResume: boolean;
  source: 'website' | 'manual';
  stage: Stage;
  rating: number | null;
  rejectionReason: string | null;
  createdAt: Date;
};

const applicantColumns = {
  id: jobApplicants.id,
  jobOpeningId: jobApplicants.jobOpeningId,
  fullName: jobApplicants.fullName,
  email: jobApplicants.email,
  phone: jobApplicants.phone,
  coverNote: jobApplicants.coverNote,
  hasResume: sql<boolean>`${jobApplicants.resumePath} is not null`,
  source: jobApplicants.source,
  stage: jobApplicants.stage,
  rating: jobApplicants.rating,
  rejectionReason: jobApplicants.rejectionReason,
  createdAt: jobApplicants.createdAt,
};

export async function listApplicants(ctx: TenantContext, openingId: string) {
  requirePermission(ctx, 'recruitment.manage');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select(applicantColumns)
      .from(jobApplicants)
      .where(
        and(
          eq(jobApplicants.tenantId, ctx.tenantId),
          eq(jobApplicants.jobOpeningId, openingId),
          isNull(jobApplicants.deletedAt),
        ),
      )
      .orderBy(desc(jobApplicants.rating), asc(jobApplicants.createdAt)),
  );
  return rows as ApplicantRow[];
}

export async function getApplicant(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'recruitment.manage');
  return withRls(ctx, async (tx) => {
    const [applicant] = await tx
      .select({ ...applicantColumns, jobTitle: jobOpenings.title })
      .from(jobApplicants)
      .innerJoin(
        jobOpenings,
        and(
          eq(jobOpenings.tenantId, jobApplicants.tenantId),
          eq(jobOpenings.id, jobApplicants.jobOpeningId),
        ),
      )
      .where(
        and(
          eq(jobApplicants.tenantId, ctx.tenantId),
          eq(jobApplicants.id, id),
          isNull(jobApplicants.deletedAt),
        ),
      )
      .limit(1);
    if (!applicant) return null;
    const notes = await tx
      .select({
        id: applicantNotes.id,
        body: applicantNotes.body,
        createdAt: applicantNotes.createdAt,
        author: users.fullName,
      })
      .from(applicantNotes)
      .leftJoin(users, eq(users.id, applicantNotes.createdBy))
      .where(and(eq(applicantNotes.tenantId, ctx.tenantId), eq(applicantNotes.applicantId, id)))
      .orderBy(desc(applicantNotes.createdAt));
    return { ...(applicant as ApplicantRow & { jobTitle: string }), notes };
  });
}
