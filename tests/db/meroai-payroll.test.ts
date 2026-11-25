import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.HR_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

import { addDaysToDate, mondayOf, zonedToday } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import {
  authoriseRosterTimesheets,
  payrollPreview,
  runPayrollWithMeroAI,
} from '@/modules/ai/meroai-payroll';
import { runPayrollSchema } from '@/modules/ai/schemas';
import { acceptOffer } from '@/modules/hiring/public';
import { acceptOfferSchema, createHireSchema } from '@/modules/hiring/schemas';
import { createHire, payrollBinding, sendContract } from '@/modules/hiring/service';
import { linkEmployeeLogin } from '@/modules/hiring/staff-service';
import { listPayslipsForRoster } from '@/modules/payroll/queries';
import { createRosterSchema, publishRosterSchema, saveShiftSchema } from '@/modules/roster/schemas';
import { createRoster, publishRoster, saveShift } from '@/modules/roster/service';
import { decideEntries } from '@/modules/timesheets/service';
import type { TenantContext } from '@/server/context';
import { encryptField } from '@/server/crypto';
import { adminDb } from '@/server/db/admin';

import {
  addMember,
  contextFor,
  createWorkspace,
  destroyWorkspace,
  handedOver,
} from '../support/workspaces';

// MeroAI and pay (ADR-084), against the real database and RLS: MeroAI authorises a roster's
// timesheets without paying anything; a manager can unauthorise and change a shift; payroll runs
// only from authorised timesheets, stops before releasing when tax must be entered by hand, and
// otherwise releases the payslips. Another business and staff are kept out throughout.

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;
const rows = async <T>(query: ReturnType<typeof sql>) =>
  (await adminDb().execute(query)) as unknown as T[];

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

let tenantId: string;
let betaTenant: string;
const userIds: string[] = [];
const betaUsers: string[] = [];
let owner: TenantContext;
let betaOwner: TenantContext;
let staffCtx: TenantContext;
let alex: { userId: string; employeeId: string };

async function hire(firstName: string) {
  const userId = await addMember(tenantId, mail(firstName), `${firstName} Pay`, 'member');
  const hired = await createHire(
    owner,
    createHireSchema.parse({
      firstName,
      lastName: 'Pay',
      email: mail(`${firstName}-hire`),
      employmentType: 'casual',
      positionTitle: 'Assistant',
      startDate: '2026-07-06',
      payBasis: 'hourly',
      payRate: '40',
    }),
  );
  const link = handedOver(await sendContract(owner, hired.contractId));
  await acceptOffer(
    acceptOfferSchema.parse({
      token: link.split('/offer/')[1],
      fullName: `${firstName} Pay`,
      readContract: true,
      readStatements: true,
    }),
    { ip: null, userAgent: null },
  );
  await linkEmployeeLogin(owner, { employeeId: hired.employeeId, userId });
  userIds.push(userId);
  return { userId, employeeId: hired.employeeId };
}

async function declareTfn(employeeId: string) {
  const tfn = encryptField('123456782', payrollBinding(tenantId, employeeId, 'tfn'));
  await adminDb().execute(sql`
    insert into employee_payroll_details
      (tenant_id, employee_id, tax_file_number_ciphertext, tax_resident,
       claims_tax_free_threshold, has_study_loan)
    values (${tenantId}, ${employeeId}, ${tfn}, true, true, false)`);
}

async function workedWeek(startsOn: string) {
  const rosterId = (await createRoster(owner, createRosterSchema.parse({ startsOn, span: 'week' })))
    .id;
  await saveShift(
    owner,
    saveShiftSchema.parse({
      rosterId,
      userId: alex.userId,
      date: startsOn,
      startTime: '09:00',
      endTime: '17:30',
    }),
  );
  await publishRoster(owner, publishRosterSchema.parse({ id: rosterId }));
  return rosterId;
}

const run = (date: string) =>
  runPayrollSchema.parse({
    date,
    paymentDate: addDaysToDate(date, 10),
    superRate: '12',
    employerDetails: 'Pay Test Pty Ltd',
  });

beforeAll(async () => {
  const a = await createWorkspace('Pay Alpha', mail('pay-alpha'));
  tenantId = a.tenantId;
  userIds.push(a.ownerId);
  owner = await contextFor(a.ownerId, tenantId);
  alex = await hire('Alex');
  staffCtx = await contextFor(alex.userId, tenantId);
  const b = await createWorkspace('Pay Beta', mail('pay-beta'));
  betaTenant = b.tenantId;
  betaUsers.push(b.ownerId);
  betaOwner = await contextFor(b.ownerId, betaTenant);
}, 180_000);

afterAll(async () => {
  if (tenantId) await destroyWorkspace(tenantId, userIds);
  if (betaTenant) await destroyWorkspace(betaTenant, betaUsers);
}, 60_000);

describe('a week with tax still to enter by hand', () => {
  let rosterId: string;
  let monday: string;

  beforeAll(async () => {
    monday = addDaysToDate(mondayOf(zonedToday(owner.tenant.timezone)), -21);
    rosterId = await workedWeek(monday);
  }, 60_000);

  it('MeroAI authorises the timesheets from the roster, without paying anything', async () => {
    const result = await authoriseRosterTimesheets(owner, rosterId);
    expect(result).toMatchObject({ authorised: 1, needYou: 0 });
    const [roster] = await rows<{ authorised_at: string | null }>(sql`
      select authorised_at from rosters where id = ${rosterId}`);
    expect(roster?.authorised_at).toBeNull();
    expect(await listPayslipsForRoster(owner, rosterId)).toEqual([]);
  });

  it('another business and staff cannot authorise this roster’s timesheets', async () => {
    await expectCode(() => authoriseRosterTimesheets(betaOwner, rosterId), 'NOT_FOUND');
    await expectCode(() => authoriseRosterTimesheets(staffCtx, rosterId), 'FORBIDDEN');
  });

  it('unauthorising a shift holds payroll back until it is authorised again', async () => {
    const [entry] = await rows<{ id: string }>(sql`
      select id from time_entries where tenant_id = ${tenantId} and user_id = ${alex.userId}
      and deleted_at is null order by clock_in desc limit 1`);
    await decideEntries(owner, { ids: [entry!.id], decision: 'pending' });
    const held = await payrollPreview(owner, monday);
    expect(held?.blockers.join(' ')).toContain('waiting to be authorised');
    await expectCode(() => runPayrollWithMeroAI(owner, run(monday)), 'CONFLICT');
    await decideEntries(owner, { ids: [entry!.id], decision: 'approved' });
    expect((await payrollPreview(owner, monday))?.blockers).toEqual([]);
  });

  it('staff and another business cannot run payroll', async () => {
    await expectCode(() => runPayrollWithMeroAI(staffCtx, run(monday)), 'FORBIDDEN');
    await expectCode(() => runPayrollWithMeroAI(betaOwner, run(monday)), 'CONFLICT');
  });

  it('stops before releasing when a payslip’s tax must be entered by hand', async () => {
    const result = await runPayrollWithMeroAI(owner, run(monday));
    expect(result).toMatchObject({ created: 1, released: 0 });
    expect(result.taxByHand).toHaveLength(1);
    const [slip] = await listPayslipsForRoster(owner, rosterId);
    expect(slip?.status).toBe('draft');
  });
});

describe('a week where tax can be worked out', () => {
  let rosterId: string;
  let monday: string;

  beforeAll(async () => {
    await declareTfn(alex.employeeId);
    monday = addDaysToDate(mondayOf(zonedToday(owner.tenant.timezone)), -14);
    rosterId = await workedWeek(monday);
    await authoriseRosterTimesheets(owner, rosterId);
  }, 60_000);

  it('pays from the authorised timesheets and releases the payslips', async () => {
    const result = await runPayrollWithMeroAI(owner, run(monday));
    expect(result).toMatchObject({ created: 1, released: 1, taxByHand: [] });
    const [slip] = await listPayslipsForRoster(owner, rosterId);
    expect(slip?.status).toBe('released');
    // Tests never send mail: email counts as not set up.
    expect(result).toMatchObject({ emailed: 0 });
  });

  it('a paid period cannot be paid again', async () => {
    expect(await payrollPreview(owner, monday)).toBeNull();
    await expectCode(() => runPayrollWithMeroAI(owner, run(monday)), 'CONFLICT');
  });
});
