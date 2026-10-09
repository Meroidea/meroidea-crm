import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.HR_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

import { timeEntries } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { acceptOffer } from '@/modules/hiring/public';
import { acceptOfferSchema, createHireSchema } from '@/modules/hiring/schemas';
import { createHire, sendContract } from '@/modules/hiring/service';
import { linkEmployeeLogin } from '@/modules/hiring/staff-service';
import { listPayslipsForRoster } from '@/modules/payroll/queries';
import { authoriseRosterSchema } from '@/modules/payroll/schemas';
import { authoriseRoster } from '@/modules/payroll/service';
import { createRosterSchema, saveShiftSchema } from '@/modules/roster/schemas';
import { createRoster, publishRoster, saveShift } from '@/modules/roster/service';
import { workedMinutes } from '@/modules/timesheets/minutes';
import { getOpenEntry, listTimeEntries } from '@/modules/timesheets/queries';
import { manualEntrySchema } from '@/modules/timesheets/schemas';
import {
  clockIn,
  clockOut,
  decideEntries,
  deleteEntry,
  saveManualEntry,
} from '@/modules/timesheets/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;
const WEEK = { from: '2024-06-03', to: '2024-06-09' };

let alphaTenant: string;
let betaTenant: string;
let alphaUsers: string[];
let betaUsers: string[];
let owner: TenantContext;
let casey: TenantContext;
let drew: TenantContext;
let betaOwner: TenantContext;

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (error: unknown) => (error instanceof AppError ? error.code : String(error)),
  );

const manual = (date: string, start: string, end: string, breakMinutes = 0, extra = {}) =>
  manualEntrySchema.parse({ date, start, end, breakMinutes, note: '', ...extra });

beforeAll(async () => {
  const alpha = await createWorkspace(`Clock Alpha ${stamp}`, mail('clock-alpha-owner'));
  const beta = await createWorkspace(`Clock Beta ${stamp}`, mail('clock-beta-owner'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  const caseyId = await addMember(alphaTenant, mail('clock-casey'), 'Casey Clock', 'member');
  const drewId = await addMember(alphaTenant, mail('clock-drew'), 'Drew Desk', 'member');
  alphaUsers = [alpha.ownerId, caseyId, drewId];
  betaUsers = [beta.ownerId];
  owner = await contextFor(alpha.ownerId, alphaTenant);
  casey = await contextFor(caseyId, alphaTenant);
  drew = await contextFor(drewId, alphaTenant);
  betaOwner = await contextFor(beta.ownerId, betaTenant);
});

afterAll(async () => {
  await destroyWorkspace(alphaTenant, alphaUsers);
  await destroyWorkspace(betaTenant, betaUsers);
});

describe('clocking in and out', () => {
  it('a person clocks in once, then out', async () => {
    await clockIn(casey, null);
    expect(await getOpenEntry(casey)).not.toBeNull();
    expect(await code(clockIn(casey, null))).toBe('CONFLICT');
    await clockOut(casey, 0);
    expect(await getOpenEntry(casey)).toBeNull();
    expect(await code(clockOut(casey, 0))).toBe('CONFLICT');
  });

  it('a break longer than the time worked is refused', async () => {
    await clockIn(drew, null);
    expect(await code(clockOut(drew, 45))).toBe('VALIDATION');
    await clockOut(drew, 0);
  });

  it('the database itself allows only one open entry per person', async () => {
    await clockIn(casey, null);
    await expect(
      withRls(casey, (tx) =>
        tx.insert(timeEntries).values({
          tenantId: alphaTenant,
          userId: casey.userId,
          clockIn: new Date(),
        }),
      ),
    ).rejects.toThrow();
    await clockOut(casey, 0);
  });
});

describe('adding time by hand', () => {
  it('the form accepts its own output and "Me" as the person', () => {
    const parsed = manual('2024-06-03', '09:00', '17:00', 30, { userId: '' });
    expect(parsed.userId).toBeUndefined();
    expect(manualEntrySchema.parse(parsed)).toEqual(parsed);
  });

  it('records worked minutes after the break, including past midnight', async () => {
    await saveManualEntry(casey, manual('2024-06-03', '09:00', '17:00', 30));
    await saveManualEntry(casey, manual('2024-06-04', '22:00', '02:00', 0));
    const rows = await listTimeEntries(casey, { scope: 'mine', ...WEEK });
    expect(rows.map(workedMinutes)).toEqual([450, 240]);
    expect(rows.every((row) => row.status === 'pending' && row.source === 'manual')).toBe(true);
  });

  it('refuses the future, and a break longer than the shift', async () => {
    expect(await code(saveManualEntry(casey, manual('2099-01-01', '09:00', '10:00')))).toBe(
      'VALIDATION',
    );
    expect(await code(saveManualEntry(casey, manual('2024-06-05', '09:00', '10:00', 60)))).toBe(
      'VALIDATION',
    );
  });

  it('a person cannot add time for a colleague', async () => {
    const input = manual('2024-06-05', '09:00', '10:00', 0, { userId: drew.userId });
    expect(await code(saveManualEntry(casey, input))).toBe('FORBIDDEN');
  });
});

describe('who can see and approve', () => {
  it("a colleague and another business see none of a person's time", async () => {
    expect(await listTimeEntries(drew, { scope: 'everyone', ...WEEK })).toEqual([]);
    expect(await listTimeEntries(betaOwner, { scope: 'everyone', ...WEEK })).toEqual([]);
  });

  it('a person cannot approve their own time, even straight at the database', async () => {
    const [entry] = await listTimeEntries(casey, { scope: 'mine', ...WEEK });
    expect(await code(decideEntries(casey, { ids: [entry!.id], decision: 'approved' }))).toBe(
      'FORBIDDEN',
    );
    await expect(
      withRls(casey, (tx) => tx.update(timeEntries).set({ status: 'approved' })),
    ).rejects.toThrow();
  });

  it("another business cannot approve or remove a person's time", async () => {
    const [entry] = await listTimeEntries(casey, { scope: 'mine', ...WEEK });
    expect(await code(decideEntries(betaOwner, { ids: [entry!.id], decision: 'approved' }))).toBe(
      'NOT_FOUND',
    );
    expect(await code(deleteEntry(betaOwner, entry!.id))).toBe('NOT_FOUND');
    expect(await code(deleteEntry(drew, entry!.id))).toBe('NOT_FOUND');
  });

  it("a manager approves, and an approved entry is then out of the person's hands", async () => {
    const rows = await listTimeEntries(owner, { scope: 'everyone', ...WEEK });
    expect(rows.map((row) => row.personName)).toEqual(['Casey Clock', 'Casey Clock']);
    await decideEntries(owner, { ids: [rows[0]!.id], decision: 'approved' });
    expect(await code(deleteEntry(casey, rows[0]!.id))).toBe('CONFLICT');
    expect(
      await code(
        saveManualEntry(casey, manual('2024-06-03', '09:00', '18:00', 30, { id: rows[0]!.id })),
      ),
    ).toBe('CONFLICT');
  });

  it('a manager correcting an entry sends it back to waiting', async () => {
    const [first] = await listTimeEntries(owner, { scope: 'everyone', ...WEEK });
    await saveManualEntry(owner, manual('2024-06-03', '09:00', '16:00', 30, { id: first!.id }));
    const [after] = await listTimeEntries(owner, { scope: 'everyone', ...WEEK });
    expect([after!.status, workedMinutes(after!)]).toEqual(['pending', 390]);
  });
});

describe('paying from timesheets', () => {
  let rosterId: string;
  const authorise = (hoursFrom: 'roster' | 'timesheets') =>
    authoriseRosterSchema.parse({
      rosterId,
      paymentDate: '2024-06-12',
      superRate: '12',
      employerDetails: 'Clock Alpha Pty Ltd',
      hoursFrom,
    });

  beforeAll(async () => {
    const hired = await createHire(
      owner,
      createHireSchema.parse({
        firstName: 'Casey',
        lastName: 'Clock',
        email: mail('casey-hire'),
        employmentType: 'casual',
        positionTitle: 'Assistant',
        startDate: '2024-01-08',
        payBasis: 'hourly',
        payRate: '30.00',
      }),
    );
    const { link } = await sendContract(owner, hired.contractId);
    await acceptOffer(
      acceptOfferSchema.parse({
        token: link.split('/offer/')[1],
        fullName: 'Casey Clock',
        readContract: true,
        readStatements: true,
      }),
      { ip: null, userAgent: null },
    );
    await linkEmployeeLogin(owner, { employeeId: hired.employeeId, userId: casey.userId });
    rosterId = (
      await createRoster(owner, createRosterSchema.parse({ startsOn: WEEK.from, span: 'week' }))
    ).id;
    // Rostered for 8 hours; the clock says otherwise.
    await saveShift(
      owner,
      saveShiftSchema.parse({
        rosterId,
        userId: casey.userId,
        date: '2024-06-03',
        startTime: '09:00',
        endTime: '17:00',
        breakMinutes: 0,
      }),
    );
    await publishRoster(owner, rosterId);
  }, 60_000);

  it('refuses while entries in the period are still waiting', async () => {
    expect(await code(authoriseRoster(owner, authorise('timesheets')))).toBe('CONFLICT');
  });

  it('pays the approved clocked hours, not the rostered ones, and leaves out rejected time', async () => {
    const rows = await listTimeEntries(owner, { scope: 'everyone', ...WEEK });
    await decideEntries(owner, { ids: [rows[0]!.id], decision: 'approved' });
    await decideEntries(owner, { ids: [rows[1]!.id], decision: 'rejected' });
    const result = await authoriseRoster(owner, authorise('timesheets'));
    expect(result).toEqual({ created: 1, skipped: [] });
    const [slip] = await listPayslipsForRoster(owner, rosterId);
    // 6h30m at 30.00 = 195.00, not the 8 rostered hours.
    expect(slip).toMatchObject({ minutes: 390, gross: '195.00', superAmount: '23.40' });
  });

  it('time in an authorised pay period can no longer change', async () => {
    const rows = await listTimeEntries(owner, { scope: 'everyone', ...WEEK });
    expect(await code(decideEntries(owner, { ids: [rows[1]!.id], decision: 'approved' }))).toBe(
      'CONFLICT',
    );
    expect(await code(deleteEntry(owner, rows[0]!.id))).toBe('CONFLICT');
    expect(await code(saveManualEntry(owner, manual('2024-06-06', '09:00', '10:00')))).toBe(
      'CONFLICT',
    );
  });
});

describe('clocking in only at the workplace', () => {
  const shop = { latitude: -33.86882, longitude: 151.20929 };
  const at = (metresSouth: number, accuracy = 8) => ({
    latitude: shop.latitude - metresSouth / 111_195,
    longitude: shop.longitude,
    accuracy,
  });
  let caseyThere: TenantContext;
  let ownerThere: TenantContext;

  beforeAll(async () => {
    await adminDb().execute(sql`
      update tenants set location_latitude = ${shop.latitude}, location_longitude = ${shop.longitude},
        clock_radius_metres = 10
      where id = ${alphaTenant}`);
    caseyThere = await contextFor(casey.userId, alphaTenant);
    ownerThere = await contextFor(owner.userId, alphaTenant);
  });

  it('the business location reaches the people who work there, and nobody else', async () => {
    expect(caseyThere.tenant.clockLocation).toEqual({ ...shop, radiusMetres: 10 });
    expect((await contextFor(betaOwner.userId, betaTenant)).tenant.clockLocation).toBeNull();
  });

  it('refuses to clock in without a location', async () => {
    expect(await code(clockIn(caseyThere, null))).toBe('VALIDATION');
  });

  it('refuses to clock in from further than 10 metres away', async () => {
    expect(await code(clockIn(caseyThere, null, at(11)))).toBe('FORBIDDEN');
    expect(await code(clockIn(caseyThere, null, at(250)))).toBe('FORBIDDEN');
    expect(await getOpenEntry(caseyThere)).toBeNull();
  });

  it('refuses a reading too vague to say where the person is', async () => {
    expect(await code(clockIn(caseyThere, null, at(0, 400)))).toBe('VALIDATION');
  });

  it('clocks in inside the radius, and then will not clock out from somewhere else', async () => {
    await clockIn(caseyThere, null, at(6));
    expect(await code(clockOut(caseyThere, 0))).toBe('VALIDATION');
    expect(await code(clockOut(caseyThere, 0, at(40)))).toBe('FORBIDDEN');
    expect(await getOpenEntry(caseyThere)).not.toBeNull();
    await clockOut(caseyThere, 0, at(9));
    const rows = (await adminDb().execute(sql`
      select clock_in_distance_m, clock_out_distance_m from time_entries
      where tenant_id = ${alphaTenant} and user_id = ${casey.userId} and source = 'clock'
      order by clock_in desc limit 1`)) as unknown as Record<string, number>[];
    expect(rows[0]).toEqual({ clock_in_distance_m: 6, clock_out_distance_m: 9 });
  });

  it('staff can no longer type their own hours in; a manager still can for them', async () => {
    expect(await code(saveManualEntry(caseyThere, manual('2024-07-01', '09:00', '10:00')))).toBe(
      'FORBIDDEN',
    );
    const input = manual('2024-07-01', '09:00', '10:00', 0, { userId: casey.userId });
    expect(await code(saveManualEntry(ownerThere, input))).toBe('OK');
  });
});

describe('the feature switch', () => {
  it('switching timesheets off stops clocking in', async () => {
    await adminDb().execute(
      sql`update tenants set features = array_remove(features, 'timesheets') where id = ${alphaTenant}`,
    );
    const ctx = await contextFor(casey.userId, alphaTenant);
    expect(await code(clockIn(ctx, null))).toBe('FORBIDDEN');
  });
});
