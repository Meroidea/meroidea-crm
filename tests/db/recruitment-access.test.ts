import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { jobApplicants } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { getPublicOpening, submitApplication } from '@/modules/recruitment/public';
import {
  getApplicant,
  getOpening,
  listApplicants,
  listOpenings,
} from '@/modules/recruitment/queries';
import { matchesResume, resumeExtension } from '@/modules/recruitment/resumes';
import {
  addApplicantSchema,
  applicantFieldsSchema,
  saveOpeningSchema,
} from '@/modules/recruitment/schemas';
import {
  addApplicant,
  addApplicantNote,
  deleteApplicant,
  getResumeUrl,
  moveApplicant,
  rateApplicant,
  saveOpening,
  setOpeningStatus,
} from '@/modules/recruitment/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';
import { readObject } from '@/server/storage';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

const stamp = Date.now();
/** A documentation address (RFC 5737) standing in for the applicant's browser. */
const SENDER = '192.0.2.10';
const mail = (name: string) => `${name}-${stamp}@example.com`;

let alphaTenant: string;
let betaTenant: string;
let alphaUsers: string[];
let betaUsers: string[];
let owner: TenantContext;
let member: TenantContext;
let betaOwner: TenantContext;
let openingId: string;
let token: string;
let applicantId: string;

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (error: unknown) => (error instanceof AppError ? error.code : String(error)),
  );

const job = saveOpeningSchema.parse({
  title: 'Weekend barista',
  employmentType: 'casual',
  location: 'Harbour Street',
  description: 'Make coffee and look after customers on Saturdays and Sundays.',
});
const person = (name: string, email: string) =>
  applicantFieldsSchema.parse({ fullName: name, email, phone: '', coverNote: 'I love coffee.' });
const pdf = Buffer.from('%PDF-1.4 sample resume');

beforeAll(async () => {
  const alpha = await createWorkspace(`Hire Alpha ${stamp}`, mail('ats-alpha-owner'));
  const beta = await createWorkspace(`Hire Beta ${stamp}`, mail('ats-beta-owner'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  const memberId = await addMember(alphaTenant, mail('ats-member'), 'Max Member', 'member');
  alphaUsers = [alpha.ownerId, memberId];
  betaUsers = [beta.ownerId];
  owner = await contextFor(alpha.ownerId, alphaTenant);
  member = await contextFor(memberId, alphaTenant);
  betaOwner = await contextFor(beta.ownerId, betaTenant);
});

afterAll(async () => {
  await destroyWorkspace(alphaTenant, alphaUsers);
  await destroyWorkspace(betaTenant, betaUsers);
});

describe('job openings', () => {
  it('a job starts as a draft with no public page', async () => {
    openingId = (await saveOpening(owner, job)).id;
    const opening = await getOpening(owner, openingId);
    token = opening!.publicToken;
    expect(opening).toMatchObject({ status: 'draft', applicants: 0 });
    expect(await getPublicOpening(token)).toBeNull();
    expect(
      await code(submitApplication(token, person('Early Bird', mail('early')), null, SENDER)),
    ).toBe('NOT_FOUND');
  });

  it('general staff and other businesses cannot see or change it', async () => {
    expect(await code(listOpenings(member))).toBe('FORBIDDEN');
    expect(await code(saveOpening(member, job))).toBe('FORBIDDEN');
    expect(await listOpenings(betaOwner)).toEqual([]);
    expect(await getOpening(betaOwner, openingId)).toBeNull();
    expect(await code(setOpeningStatus(betaOwner, { id: openingId, status: 'open' }))).toBe(
      'NOT_FOUND',
    );
  });

  it('once open, the public page shows only the advertisement', async () => {
    await setOpeningStatus(owner, { id: openingId, status: 'open' });
    expect(await getPublicOpening(token)).toEqual({
      title: 'Weekend barista',
      employmentType: 'casual',
      location: 'Harbour Street',
      description: job.description,
      businessName: owner.tenant.name,
    });
    expect(await getPublicOpening('not-a-real-token-000000')).toBeNull();
    expect(await getPublicOpening("x' or 1=1 --")).toBeNull();
  });
});

describe('applying from the public page', () => {
  it('one sender cannot use up a job’s allowance; another sender still gets through', async () => {
    const flooder = '192.0.2.200';
    for (let n = 0; n < 5; n++) {
      await submitApplication(token, person(`Bot ${n}`, mail(`bot-${n}`)), null, flooder);
    }
    expect(
      await code(submitApplication(token, person('Bot 6', mail('bot-6')), null, flooder)),
    ).toBe('RATE_LIMITED');
    await submitApplication(token, person('Real Person', mail('real')), null, '192.0.2.201');
    const names = (await listApplicants(owner, openingId)).map((row) => row.fullName);
    expect(names).toContain('Real Person');
    expect(names).not.toContain('Bot 6');
    await adminDb().execute(
      sql`delete from job_applicants where tenant_id = ${alphaTenant} and (full_name like 'Bot %' or full_name = 'Real Person')`,
    );
  });

  it('knows a real résumé from something pretending to be one', () => {
    expect(resumeExtension('cv.PDF')).toBe('pdf');
    expect(resumeExtension('cv.exe')).toBeNull();
    expect(matchesResume('pdf', pdf)).toBe(true);
    expect(matchesResume('docx', pdf)).toBe(false);
  });

  it('records an application with its résumé', async () => {
    await submitApplication(
      token,
      person('Ada Applicant', mail('Ada')),
      { name: 'ada.pdf', bytes: pdf },
      SENDER,
    );
    const [ada] = await listApplicants(owner, openingId);
    applicantId = ada!.id;
    expect(ada).toMatchObject({
      fullName: 'Ada Applicant',
      email: mail('ada'),
      source: 'website',
      stage: 'applied',
      hasResume: true,
    });
    expect((await getResumeUrl(owner, applicantId)).url).toContain('token=');
  });

  it('refuses a file that is not what its name says', async () => {
    expect(
      await code(
        submitApplication(
          token,
          person('Fay Fake', mail('fay')),
          { name: 'cv.docx', bytes: pdf },
          SENDER,
        ),
      ),
    ).toBe('VALIDATION');
    expect(await listApplicants(owner, openingId)).toHaveLength(1);
  });

  it('applying twice changes nothing and reveals nothing', async () => {
    await submitApplication(token, person('Ada Again', mail('ADA')), null, SENDER);
    const rows = await listApplicants(owner, openingId);
    expect(rows.map((row) => row.fullName)).toEqual(['Ada Applicant']);
  });

  it('a closed job stops taking applications', async () => {
    await setOpeningStatus(owner, { id: openingId, status: 'closed' });
    expect(
      await code(submitApplication(token, person('Late Lee', mail('late')), null, SENDER)),
    ).toBe('NOT_FOUND');
    await setOpeningStatus(owner, { id: openingId, status: 'open' });
  });

  it('stops accepting when a job is being flooded', async () => {
    await adminDb().execute(sql`
      insert into job_applicants (tenant_id, job_opening_id, full_name, email, source)
      select ${alphaTenant}, ${openingId}, 'Flood ' || n, 'flood-' || n || ${`-${stamp}@example.com`}, 'website'
      from generate_series(1, 100) n`);
    expect(
      await code(submitApplication(token, person('One More', mail('more')), null, '192.0.2.77')),
    ).toBe('RATE_LIMITED');
    await adminDb().execute(
      sql`delete from job_applicants where tenant_id = ${alphaTenant} and full_name like 'Flood %'`,
    );
  });
});

describe('working through applicants', () => {
  it('the team adds someone by hand, once', async () => {
    const input = addApplicantSchema.parse({
      jobOpeningId: openingId,
      ...person('Ben Walk-in', mail('ben')),
    });
    await addApplicant(owner, input);
    expect(await code(addApplicant(owner, input))).toBe('DUPLICATE');
    expect(await code(addApplicant(member, input))).toBe('FORBIDDEN');
  });

  it('moves, rates and notes an applicant', async () => {
    await moveApplicant(owner, { id: applicantId, stage: 'interview', rejectionReason: null });
    await rateApplicant(owner, { id: applicantId, rating: 4 });
    await addApplicantNote(owner, { applicantId, body: 'Great on the phone.' });
    const ada = await getApplicant(owner, applicantId);
    expect(ada).toMatchObject({ stage: 'interview', rating: 4, jobTitle: 'Weekend barista' });
    expect(ada?.notes.map((note) => note.body)).toEqual(['Great on the phone.']);
  });

  it('keeps a reason only while someone is not progressing', async () => {
    await moveApplicant(owner, {
      id: applicantId,
      stage: 'rejected',
      rejectionReason: 'No weekends',
    });
    expect((await getApplicant(owner, applicantId))?.rejectionReason).toBe('No weekends');
    await moveApplicant(owner, { id: applicantId, stage: 'offer', rejectionReason: 'ignored' });
    expect((await getApplicant(owner, applicantId))?.rejectionReason).toBeNull();
  });

  it('general staff cannot read applicants, even straight at the database', async () => {
    expect(await code(listApplicants(member, openingId))).toBe('FORBIDDEN');
    expect(await code(getResumeUrl(member, applicantId))).toBe('FORBIDDEN');
    const rows = await withRls(member, (tx) =>
      tx.select({ id: jobApplicants.id }).from(jobApplicants),
    );
    expect(rows).toEqual([]);
  });

  it("another business cannot read, move or delete a business's applicants", async () => {
    expect(await getApplicant(betaOwner, applicantId)).toBeNull();
    expect(await listApplicants(betaOwner, openingId)).toEqual([]);
    expect(
      await code(
        moveApplicant(betaOwner, { id: applicantId, stage: 'hired', rejectionReason: null }),
      ),
    ).toBe('NOT_FOUND');
    expect(await code(getResumeUrl(betaOwner, applicantId))).toBe('NOT_FOUND');
    expect(await code(deleteApplicant(betaOwner, applicantId))).toBe('NOT_FOUND');
  });

  it('deleting an applicant removes their résumé too', async () => {
    const rows = (await adminDb().execute(
      sql`select resume_path from job_applicants where id = ${applicantId}`,
    )) as unknown as { resume_path: string }[];
    const path = rows[0]!.resume_path;
    expect(await readObject(path)).not.toBeNull();
    await deleteApplicant(owner, applicantId);
    expect(await readObject(path)).toBeNull();
    expect(await getApplicant(owner, applicantId)).toBeNull();
  });
});
