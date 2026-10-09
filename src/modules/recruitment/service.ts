import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { applicantNotes, jobApplicants, jobOpenings } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';
import { createDownloadUrl, removeObject } from '@/server/storage';

import type {
  AddApplicantInput,
  MoveApplicantInput,
  OpeningStatus,
  SaveOpeningInput,
} from './schemas';

async function findOpening(tx: Tx, ctx: TenantContext, id: string) {
  const [opening] = await tx
    .select({ id: jobOpenings.id, status: jobOpenings.status })
    .from(jobOpenings)
    .where(
      and(
        eq(jobOpenings.tenantId, ctx.tenantId),
        eq(jobOpenings.id, id),
        isNull(jobOpenings.deletedAt),
      ),
    )
    .limit(1);
  if (!opening) throw new AppError('NOT_FOUND', 'That job was not found.');
  return opening;
}

async function findApplicant(tx: Tx, ctx: TenantContext, id: string) {
  const [applicant] = await tx
    .select()
    .from(jobApplicants)
    .where(
      and(
        eq(jobApplicants.tenantId, ctx.tenantId),
        eq(jobApplicants.id, id),
        isNull(jobApplicants.deletedAt),
      ),
    )
    .limit(1);
  if (!applicant) throw new AppError('NOT_FOUND', 'That applicant was not found.');
  return applicant;
}

/** Creates a job as a draft, or edits one. Nothing is public until it is opened. */
export async function saveOpening(
  ctx: TenantContext,
  input: SaveOpeningInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'recruitment.manage');
  const values = {
    title: input.title,
    employmentType: input.employmentType,
    location: input.location,
    description: input.description,
    updatedBy: ctx.userId,
  };
  return withRls(ctx, async (tx) => {
    if (input.id) {
      const opening = await findOpening(tx, ctx, input.id);
      await tx
        .update(jobOpenings)
        .set(values)
        .where(and(eq(jobOpenings.tenantId, ctx.tenantId), eq(jobOpenings.id, opening.id)));
      await audit(tx, ctx, { action: 'update', entityType: 'job_opening', entityId: opening.id });
      return { id: opening.id };
    }
    const [created] = await tx
      .insert(jobOpenings)
      .values({
        tenantId: ctx.tenantId,
        ...values,
        status: 'draft',
        publicToken: randomBytes(18).toString('base64url'),
        createdBy: ctx.userId,
      })
      .returning({ id: jobOpenings.id });
    if (!created) throw new AppError('INTERNAL', 'The job could not be saved.');
    await audit(tx, ctx, { action: 'create', entityType: 'job_opening', entityId: created.id });
    return created;
  });
}

/** Opens a job to applications, closes it, or takes it back to draft. */
export async function setOpeningStatus(
  ctx: TenantContext,
  input: { id: string; status: OpeningStatus },
): Promise<{ id: string }> {
  requirePermission(ctx, 'recruitment.manage');
  return withRls(ctx, async (tx) => {
    const opening = await findOpening(tx, ctx, input.id);
    await tx
      .update(jobOpenings)
      .set({ status: input.status, updatedBy: ctx.userId })
      .where(and(eq(jobOpenings.tenantId, ctx.tenantId), eq(jobOpenings.id, opening.id)));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'job_opening',
      entityId: opening.id,
      changes: { status: [opening.status, input.status] },
    });
    return { id: opening.id };
  });
}

/** Adds someone who applied another way: in person, by email, through a referral. */
export async function addApplicant(
  ctx: TenantContext,
  input: AddApplicantInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'recruitment.manage');
  return withRls(ctx, async (tx) => {
    const opening = await findOpening(tx, ctx, input.jobOpeningId);
    const [clash] = await tx
      .select({ id: jobApplicants.id })
      .from(jobApplicants)
      .where(
        and(
          eq(jobApplicants.tenantId, ctx.tenantId),
          eq(jobApplicants.jobOpeningId, opening.id),
          isNull(jobApplicants.deletedAt),
          sql`lower(${jobApplicants.email}) = lower(${input.email})`,
        ),
      )
      .limit(1);
    if (clash) {
      throw new AppError('DUPLICATE', 'Someone with that email has already applied for this job.', {
        email: ['Already an applicant for this job'],
      });
    }
    const [created] = await tx
      .insert(jobApplicants)
      .values({
        tenantId: ctx.tenantId,
        jobOpeningId: opening.id,
        fullName: input.fullName,
        email: input.email.toLowerCase(),
        phone: input.phone,
        coverNote: input.coverNote,
        source: 'manual',
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: jobApplicants.id });
    if (!created) throw new AppError('INTERNAL', 'The applicant could not be saved.');
    await audit(tx, ctx, { action: 'create', entityType: 'job_applicant', entityId: created.id });
    return created;
  });
}

/** Moves an applicant to another stage. A reason is kept when they are not progressing. */
export async function moveApplicant(
  ctx: TenantContext,
  input: MoveApplicantInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'recruitment.manage');
  return withRls(ctx, async (tx) => {
    const applicant = await findApplicant(tx, ctx, input.id);
    await tx
      .update(jobApplicants)
      .set({
        stage: input.stage,
        rejectionReason: input.stage === 'rejected' ? input.rejectionReason : null,
        updatedBy: ctx.userId,
      })
      .where(and(eq(jobApplicants.tenantId, ctx.tenantId), eq(jobApplicants.id, applicant.id)));
    await audit(tx, ctx, {
      action: 'stage_change',
      entityType: 'job_applicant',
      entityId: applicant.id,
      changes: { stage: [applicant.stage, input.stage] },
    });
    return { id: applicant.id };
  });
}

export async function rateApplicant(
  ctx: TenantContext,
  input: { id: string; rating: number | null },
): Promise<{ id: string }> {
  requirePermission(ctx, 'recruitment.manage');
  return withRls(ctx, async (tx) => {
    const applicant = await findApplicant(tx, ctx, input.id);
    await tx
      .update(jobApplicants)
      .set({ rating: input.rating, updatedBy: ctx.userId })
      .where(and(eq(jobApplicants.tenantId, ctx.tenantId), eq(jobApplicants.id, applicant.id)));
    await audit(tx, ctx, { action: 'update', entityType: 'job_applicant', entityId: applicant.id });
    return { id: applicant.id };
  });
}

export async function addApplicantNote(
  ctx: TenantContext,
  input: { applicantId: string; body: string },
): Promise<{ id: string }> {
  requirePermission(ctx, 'recruitment.manage');
  return withRls(ctx, async (tx) => {
    const applicant = await findApplicant(tx, ctx, input.applicantId);
    const [created] = await tx
      .insert(applicantNotes)
      .values({
        tenantId: ctx.tenantId,
        applicantId: applicant.id,
        body: input.body,
        createdBy: ctx.userId,
      })
      .returning({ id: applicantNotes.id });
    if (!created) throw new AppError('INTERNAL', 'The note could not be saved.');
    await audit(tx, ctx, { action: 'update', entityType: 'job_applicant', entityId: applicant.id });
    return created;
  });
}

/** A one-minute link to an applicant's résumé. Every download is audited. */
export async function getResumeUrl(ctx: TenantContext, id: string): Promise<{ url: string }> {
  requirePermission(ctx, 'recruitment.manage');
  const applicant = await withRls(ctx, async (tx) => {
    const found = await findApplicant(tx, ctx, id);
    if (!found.resumePath) throw new AppError('NOT_FOUND', 'This applicant sent no résumé.');
    await audit(tx, ctx, { action: 'download', entityType: 'job_applicant', entityId: found.id });
    return found;
  });
  return {
    url: await createDownloadUrl(applicant.resumePath as string, applicant.resumeName ?? 'resume'),
  };
}

/** Removes an applicant and their résumé, for example when they ask for their details to be deleted. */
export async function deleteApplicant(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'recruitment.manage');
  const applicant = await withRls(ctx, async (tx) => {
    const found = await findApplicant(tx, ctx, id);
    await tx
      .update(jobApplicants)
      .set({ deletedAt: new Date(), resumePath: null, resumeName: null, updatedBy: ctx.userId })
      .where(and(eq(jobApplicants.tenantId, ctx.tenantId), eq(jobApplicants.id, found.id)));
    await audit(tx, ctx, { action: 'delete', entityType: 'job_applicant', entityId: found.id });
    return found;
  });
  if (applicant.resumePath) await removeObject(applicant.resumePath);
  return { id: applicant.id };
}
