import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq, gte, isNull, ne, sql } from 'drizzle-orm';

import { auditLogs, jobApplicants, jobOpenings, tenants } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { adminDb } from '@/server/db/admin';
import { removeObject, writeObject } from '@/server/storage';

import { matchesResume, MAX_RESUME_BYTES, RESUME_FORMATS, resumeExtension } from './resumes';
import type { ApplicantFields } from './schemas';

/**
 * The public side of recruitment: a job's apply page, reached by its unguessable address.
 * There is no session, so this file uses the privileged client. It always starts from the
 * token and never accepts a business or job id from the caller, and it only ever reads an
 * open job's public wording and writes a new application (same pattern as ADR-026).
 */

/** Applications one job accepts per hour, so a script cannot flood a business. */
const HOURLY_LIMIT = 40;

export type PublicOpening = {
  title: string;
  employmentType: string;
  location: string | null;
  description: string;
  businessName: string;
};

async function openingByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [row] = await adminDb()
    .select({
      id: jobOpenings.id,
      tenantId: jobOpenings.tenantId,
      title: jobOpenings.title,
      employmentType: jobOpenings.employmentType,
      location: jobOpenings.location,
      description: jobOpenings.description,
      businessName: tenants.name,
    })
    .from(jobOpenings)
    .innerJoin(tenants, eq(tenants.id, jobOpenings.tenantId))
    .where(
      and(
        eq(jobOpenings.publicToken, token),
        eq(jobOpenings.status, 'open'),
        isNull(jobOpenings.deletedAt),
        // A suspended business takes no applications; a trial or active one does.
        ne(tenants.status, 'suspended'),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** What the apply page shows. Null for a job that is not open, whatever the reason. */
export async function getPublicOpening(token: string): Promise<PublicOpening | null> {
  const row = await openingByToken(token);
  if (!row) return null;
  return {
    title: row.title,
    employmentType: row.employmentType,
    location: row.location,
    description: row.description,
    businessName: row.businessName,
  };
}

/**
 * Records an application. Applying twice with the same email is answered as a success without
 * changing anything, so the page never reveals who has already applied.
 */
export async function submitApplication(
  token: string,
  fields: ApplicantFields,
  resume: { name: string; bytes: Buffer } | null,
): Promise<void> {
  const opening = await openingByToken(token);
  if (!opening) throw new AppError('NOT_FOUND', 'This job is no longer taking applications.');
  const db = adminDb();

  const [recent] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(jobApplicants)
    .where(
      and(
        eq(jobApplicants.tenantId, opening.tenantId),
        eq(jobApplicants.jobOpeningId, opening.id),
        gte(jobApplicants.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
      ),
    );
  if ((recent?.total ?? 0) >= HOURLY_LIMIT) {
    throw new AppError('CONFLICT', 'This job is receiving a lot of applications. Try again later.');
  }

  const email = fields.email.toLowerCase();
  const [existing] = await db
    .select({ id: jobApplicants.id })
    .from(jobApplicants)
    .where(
      and(
        eq(jobApplicants.tenantId, opening.tenantId),
        eq(jobApplicants.jobOpeningId, opening.id),
        isNull(jobApplicants.deletedAt),
        sql`lower(${jobApplicants.email}) = ${email}`,
      ),
    )
    .limit(1);
  if (existing) return;

  let stored: { resumePath: string; resumeName: string } | null = null;
  if (resume) {
    const extension = resumeExtension(resume.name);
    if (
      !extension ||
      resume.bytes.length === 0 ||
      resume.bytes.length > MAX_RESUME_BYTES ||
      !matchesResume(extension, resume.bytes)
    ) {
      throw new AppError(
        'VALIDATION',
        'The résumé must be a PDF or Word (.docx) file up to 5 MB.',
        {
          resume: ['Attach a PDF or .docx file up to 5 MB'],
        },
      );
    }
    const path = `${opening.tenantId}/recruitment/${opening.id}/${randomUUID()}.${extension}`;
    await writeObject(path, resume.bytes, RESUME_FORMATS[extension].mimeType);
    stored = { resumePath: path, resumeName: `${fields.fullName} resume.${extension}` };
  }

  try {
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(jobApplicants)
        .values({
          tenantId: opening.tenantId,
          jobOpeningId: opening.id,
          fullName: fields.fullName,
          email,
          phone: fields.phone,
          coverNote: fields.coverNote,
          source: 'website',
          ...stored,
        })
        .returning({ id: jobApplicants.id });
      await tx.insert(auditLogs).values({
        tenantId: opening.tenantId,
        actorUserId: null,
        actorType: 'system',
        action: 'create',
        entityType: 'job_applicant',
        entityId: created?.id ?? null,
        context: { source: 'website' },
      });
    });
  } catch (cause) {
    if (stored) await removeObject(stored.resumePath);
    throw cause;
  }
}
