import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.HR_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

import { AppError } from '@/lib/errors';
import { acceptOffer } from '@/modules/hiring/public';
import { getEmployee } from '@/modules/hiring/queries';
import { acceptOfferSchema, createHireSchema } from '@/modules/hiring/schemas';
import { createHire, sendContract } from '@/modules/hiring/service';
import { listDepartments, listStaff } from '@/modules/hiring/staff-queries';
import {
  endEmploymentSchema,
  staffFiltersSchema,
  updateProfileSchema,
} from '@/modules/hiring/staff-schemas';
import {
  assignDepartment,
  createDepartment,
  deleteDepartment,
  endEmployment,
  renameDepartment,
  updateEmployeeProfile,
} from '@/modules/hiring/staff-service';
import type { TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let alphaTenant: string;
let betaTenant: string;
let alphaUsers: string[];
let betaUsers: string[];
let owner: TenantContext;
let member: TenantContext;
let outsider: TenantContext;
let ava: string;
let ben: string;
let kitchen: string;

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

async function hireAndAccept(ctx: TenantContext, firstName: string, lastName: string) {
  const created = await createHire(
    ctx,
    createHireSchema.parse({
      firstName,
      lastName,
      email: mail(firstName.toLowerCase()),
      employmentType: 'full_time',
      positionTitle: 'Coordinator',
      startDate: '2031-03-03',
      hoursPerWeek: '38',
      payBasis: 'hourly',
      payRate: '40.00',
    }),
  );
  const { link } = await sendContract(ctx, created.contractId);
  await acceptOffer(
    acceptOfferSchema.parse({
      token: link.split('/offer/')[1],
      fullName: `${firstName} ${lastName}`,
      readContract: true,
      readStatements: true,
    }),
    { ip: null, userAgent: null },
  );
  return created.employeeId;
}

const filters = (input: Record<string, string> = {}) => staffFiltersSchema.parse(input);

beforeAll(async () => {
  const alpha = await createWorkspace('Staff Alpha', mail('staff-alpha'));
  const memberId = await addMember(alpha.tenantId, mail('staff-mem'), 'Max Member', 'member');
  const beta = await createWorkspace('Staff Beta', mail('staff-beta'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  alphaUsers = [alpha.ownerId, memberId];
  betaUsers = [beta.ownerId];
  owner = await contextFor(alpha.ownerId, alphaTenant);
  member = await contextFor(memberId, alphaTenant);
  outsider = await contextFor(beta.ownerId, betaTenant);

  ava = await hireAndAccept(owner, 'Ava', 'Active');
  ben = await hireAndAccept(owner, 'Ben', 'Baker');
  kitchen = (await createDepartment(owner, 'Kitchen')).id;
}, 120_000);

afterAll(async () => {
  if (alphaTenant) await destroyWorkspace(alphaTenant, alphaUsers);
  if (betaTenant) await destroyWorkspace(betaTenant, betaUsers);
}, 60_000);

describe('departments', () => {
  it('refuses a duplicate name regardless of case, and a member creating one at all', async () => {
    await expectCode(() => createDepartment(owner, 'kitchen'), 'CONFLICT');
    await expectCode(() => createDepartment(member, 'Front of house'), 'FORBIDDEN');
  });

  it('is invisible to a member at the database, and to another workspace entirely', async () => {
    const rows = (await withRls(member, (tx) =>
      tx.execute(sql`select count(*)::int as n from departments`),
    )) as unknown as { n: number }[];
    expect(rows[0]?.n).toBe(0);
    expect(await listDepartments(outsider)).toEqual([]);
    await expectCode(
      () => renameDepartment(outsider, { id: kitchen, name: 'Stolen' }),
      'NOT_FOUND',
    );
    await expectCode(
      () => assignDepartment(outsider, { employeeId: ava, departmentId: null }),
      'NOT_FOUND',
    );
  });

  it('counts the people assigned to it', async () => {
    await assignDepartment(owner, { employeeId: ava, departmentId: kitchen });
    expect(await listDepartments(owner)).toEqual([{ id: kitchen, name: 'Kitchen', headcount: 1 }]);
    expect((await getEmployee(owner, ava))?.departmentName).toBe('Kitchen');
  });

  it('cannot hold someone from a department in another workspace', async () => {
    const foreign = await createDepartment(outsider, 'Elsewhere');
    await expectCode(
      () => assignDepartment(owner, { employeeId: ben, departmentId: foreign.id }),
      'NOT_FOUND',
    );
  });

  it('renames, and on deletion leaves its people unassigned rather than removing them', async () => {
    await renameDepartment(owner, { id: kitchen, name: 'Back of house' });
    expect((await listDepartments(owner))[0]?.name).toBe('Back of house');

    await deleteDepartment(owner, kitchen);
    expect(await listDepartments(owner)).toEqual([]);
    const person = await getEmployee(owner, ava);
    expect(person).toMatchObject({ departmentId: null, status: 'active' });
    // The name is free again once the old one is gone.
    kitchen = (await createDepartment(owner, 'Back of house')).id;
  });
});

describe('the staff list', () => {
  it('shows current people by default and filters by search, department and status', async () => {
    await assignDepartment(owner, { employeeId: ava, departmentId: kitchen });
    const everyone = await listStaff(owner, filters());
    expect(everyone.rows.map((row) => row.displayName)).toEqual(['Ava Active', 'Ben Baker']);
    expect(everyone.counts).toEqual({ active: 2, pending: 0, ended: 0 });

    expect((await listStaff(owner, filters({ q: 'bak' }))).rows.map((row) => row.id)).toEqual([
      ben,
    ]);
    expect(
      (await listStaff(owner, filters({ department: kitchen }))).rows.map((row) => row.id),
    ).toEqual([ava]);
    expect(
      (await listStaff(owner, filters({ department: 'none' }))).rows.map((row) => row.id),
    ).toEqual([ben]);
  });

  it('is refused to a member and empty for another workspace', async () => {
    await expectCode(() => listStaff(member, filters()), 'FORBIDDEN');
    expect((await listStaff(outsider, filters({ view: 'all' }))).rows).toEqual([]);
  });
});

describe('an employee’s profile', () => {
  const profile = (overrides: Record<string, unknown> = {}) =>
    updateProfileSchema.parse({
      id: ava,
      firstName: 'Ava',
      lastName: 'Active',
      email: mail('ava'),
      preferredName: 'Avie',
      dateOfBirth: '1994-05-12',
      address: '1 Example Street, Sydney NSW 2000',
      departmentId: kitchen,
      emergencyContactName: 'Sam Active',
      emergencyContactRelationship: 'Partner',
      emergencyContactPhone: '0400 000 000',
      ...overrides,
    });

  it('saves personal details and uses the preferred name in the list', async () => {
    await updateEmployeeProfile(owner, profile());
    expect(await getEmployee(owner, ava)).toMatchObject({
      preferredName: 'Avie',
      dateOfBirth: '1994-05-12',
      emergencyContactName: 'Sam Active',
      departmentName: 'Back of house',
    });
    expect((await listStaff(owner, filters())).rows.map((row) => row.displayName)).toContain(
      'Avie',
    );
  });

  it('audits which fields changed without copying their values into the log', async () => {
    const rows = (await withRls(owner, (tx) =>
      tx.execute(sql`select context::text as context from audit_logs
                     where tenant_id = ${alphaTenant} and entity_id = ${ava}
                       and context ? 'fields' order by created_at desc limit 1`),
    )) as unknown as { context: string }[];
    expect(rows[0]?.context).toContain('dateOfBirth');
    expect(rows[0]?.context).not.toContain('1994-05-12');
    expect(rows[0]?.context).not.toContain('Example Street');
  });

  it('rejects a date of birth in the future', () => {
    expect(updateProfileSchema.safeParse({ ...profile(), dateOfBirth: '2999-01-01' }).success).toBe(
      false,
    );
  });

  it('is refused to a member and not found for another workspace', async () => {
    await expectCode(() => updateEmployeeProfile(member, profile()), 'FORBIDDEN');
    await expectCode(() => updateEmployeeProfile(outsider, profile()), 'NOT_FOUND');
    await expectCode(
      () => endEmployment(member, endEmploymentSchema.parse({ id: ava, endedOn: '2031-06-30' })),
      'FORBIDDEN',
    );
  });

  it('ends employment once, keeps the record, and moves the person out of the current list', async () => {
    const end = endEmploymentSchema.parse({ id: ben, endedOn: '2031-06-30', reason: 'Resigned' });
    await endEmployment(owner, end);
    expect(await getEmployee(owner, ben)).toMatchObject({
      status: 'ended',
      endedOn: '2031-06-30',
      endReason: 'Resigned',
    });
    await expectCode(() => endEmployment(owner, end), 'CONFLICT');

    expect((await listStaff(owner, filters())).rows.map((row) => row.id)).toEqual([ava]);
    expect((await listStaff(owner, filters({ view: 'ended' }))).rows.map((row) => row.id)).toEqual([
      ben,
    ]);
  });
});
