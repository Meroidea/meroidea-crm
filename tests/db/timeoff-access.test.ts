import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { leaveRequests } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { getMyLeaveTotals, listLeaveRequests, listLeaveTypes } from '@/modules/timeoff/queries';
import { leaveTypeSchema, requestLeaveSchema } from '@/modules/timeoff/schemas';
import { cancelLeave, decideLeave, requestLeave, saveLeaveType } from '@/modules/timeoff/service';
import { loadTenantContext, type TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let alphaTenant: string;
let betaTenant: string;
let alphaUsers: string[];
let betaUsers: string[];
let owner: TenantContext;
let alex: TenantContext;
let blair: TenantContext;
let betaOwner: TenantContext;
let annual: string;
let alexRequest: string;

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (error: unknown) => (error instanceof AppError ? error.code : String(error)),
  );

const ask = (leaveTypeId: string, startsOn: string, endsOn: string, days = '1') =>
  requestLeaveSchema.parse({ leaveTypeId, startsOn, endsOn, days, note: '' });

beforeAll(async () => {
  const alpha = await createWorkspace(`Leave Alpha ${stamp}`, mail('leave-alpha-owner'));
  const beta = await createWorkspace(`Leave Beta ${stamp}`, mail('leave-beta-owner'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  const alexId = await addMember(alphaTenant, mail('leave-alex'), 'Alex Away', 'member');
  const blairId = await addMember(alphaTenant, mail('leave-blair'), 'Blair Busy', 'member');
  alphaUsers = [alpha.ownerId, alexId, blairId];
  betaUsers = [beta.ownerId];
  owner = await contextFor(alpha.ownerId, alphaTenant);
  alex = await contextFor(alexId, alphaTenant);
  blair = await contextFor(blairId, alphaTenant);
  betaOwner = await contextFor(beta.ownerId, betaTenant);
  const types = await listLeaveTypes(alex);
  annual = types.find((type) => type.name === 'Annual leave')!.id;
});

afterAll(async () => {
  await destroyWorkspace(alphaTenant, alphaUsers);
  await destroyWorkspace(betaTenant, betaUsers);
});

describe('asking for time off', () => {
  it('a new business starts with leave types', async () => {
    expect((await listLeaveTypes(alex)).map((type) => type.name)).toEqual([
      'Annual leave',
      'Sick leave',
      'Unpaid leave',
    ]);
  });

  it('the request form accepts its own output and "Me" as the person', () => {
    const parsed = requestLeaveSchema.parse({
      leaveTypeId: annual,
      startsOn: '2031-03-03',
      endsOn: '2031-03-04',
      days: '1.5',
      note: '',
      userId: '',
    });
    expect(parsed.userId).toBeUndefined();
    expect(requestLeaveSchema.parse(parsed)).toEqual(parsed);
  });

  it('refuses dates the wrong way round and more days than the dates cover', () => {
    const base = { leaveTypeId: annual, note: '' };
    expect(
      requestLeaveSchema.safeParse({
        ...base,
        startsOn: '2031-03-05',
        endsOn: '2031-03-04',
        days: '1',
      }).success,
    ).toBe(false);
    expect(
      requestLeaveSchema.safeParse({
        ...base,
        startsOn: '2031-03-03',
        endsOn: '2031-03-04',
        days: '3',
      }).success,
    ).toBe(false);
  });

  it('a person asks for leave and sees it waiting', async () => {
    alexRequest = (await requestLeave(alex, ask(annual, '2031-03-03', '2031-03-05', '3'))).id;
    const mine = await listLeaveRequests(alex, { scope: 'mine' });
    expect(mine.map((row) => [row.id, row.status, row.days])).toEqual([
      [alexRequest, 'pending', '3.00'],
    ]);
  });

  it('overlapping dates are refused', async () => {
    expect(await code(requestLeave(alex, ask(annual, '2031-03-05', '2031-03-06')))).toBe(
      'CONFLICT',
    );
  });

  it('a leave type from another business cannot be used', async () => {
    const [betaType] = await listLeaveTypes(betaOwner);
    expect(await code(requestLeave(alex, ask(betaType!.id, '2031-04-01', '2031-04-01')))).toBe(
      'VALIDATION',
    );
  });

  it('a person cannot enter leave for a colleague', async () => {
    const input = { ...ask(annual, '2031-05-01', '2031-05-01'), userId: blair.userId };
    expect(await code(requestLeave(alex, input))).toBe('FORBIDDEN');
  });
});

describe('who can see and decide', () => {
  it("a colleague cannot see another person's request", async () => {
    expect(await listLeaveRequests(blair, { scope: 'mine' })).toEqual([]);
    expect(await listLeaveRequests(blair, { scope: 'everyone' })).toEqual([]);
    const rows = await withRls(blair, (tx) =>
      tx.select({ id: leaveRequests.id }).from(leaveRequests),
    );
    expect(rows).toEqual([]);
  });

  it('another business sees nothing and cannot decide it', async () => {
    expect(await listLeaveRequests(betaOwner, { scope: 'everyone' })).toEqual([]);
    expect(
      await code(decideLeave(betaOwner, { id: alexRequest, decision: 'approved', note: null })),
    ).toBe('NOT_FOUND');
  });

  it('a person cannot approve their own request, even straight at the database', async () => {
    expect(
      await code(decideLeave(alex, { id: alexRequest, decision: 'approved', note: null })),
    ).toBe('FORBIDDEN');
    await expect(
      withRls(alex, (tx) => tx.update(leaveRequests).set({ status: 'approved' })),
    ).rejects.toThrow();
  });

  it('a colleague cannot cancel it', async () => {
    expect(await code(cancelLeave(blair, alexRequest))).toBe('NOT_FOUND');
  });

  it('a manager sees it, approves it, and it counts toward the year', async () => {
    const waiting = await listLeaveRequests(owner, { scope: 'everyone', statuses: ['pending'] });
    expect(waiting.map((row) => row.personName)).toEqual(['Alex Away']);
    await decideLeave(owner, { id: alexRequest, decision: 'approved', note: 'Enjoy' });
    const totals = await getMyLeaveTotals(alex, 2031);
    expect(totals.find((total) => total.name === 'Annual leave')?.days).toBe('3.00');
    expect((await getMyLeaveTotals(blair, 2031)).every((total) => total.days === '0')).toBe(true);
  });

  it('a decided request cannot be decided again', async () => {
    expect(
      await code(decideLeave(owner, { id: alexRequest, decision: 'declined', note: null })),
    ).toBe('CONFLICT');
  });

  it('approved leave is cancelled by a manager, not the person', async () => {
    expect(await code(cancelLeave(alex, alexRequest))).toBe('CONFLICT');
    expect(await code(cancelLeave(owner, alexRequest))).toBe('OK');
  });

  it('a person withdraws their own waiting request', async () => {
    const { id } = await requestLeave(blair, ask(annual, '2031-06-02', '2031-06-02'));
    expect(await code(cancelLeave(blair, id))).toBe('OK');
  });

  it('a manager enters leave for someone who phoned in', async () => {
    const input = { ...ask(annual, '2031-07-01', '2031-07-01'), userId: blair.userId };
    await requestLeave(owner, input);
    expect((await listLeaveRequests(blair, { scope: 'mine' }))[0]?.startsOn).toBe('2031-07-01');
  });
});

describe('leave types', () => {
  it('only managers change them, and names stay unique', async () => {
    const study = leaveTypeSchema.parse({ name: 'Study leave', isPaid: false });
    expect(await code(saveLeaveType(alex, study))).toBe('FORBIDDEN');
    const { id } = await saveLeaveType(owner, study);
    expect(await code(saveLeaveType(owner, study))).toBe('CONFLICT');
    await saveLeaveType(owner, { ...study, id, isActive: false });
    expect(await code(requestLeave(alex, ask(id, '2031-08-01', '2031-08-01')))).toBe('VALIDATION');
  });
});

describe('the feature switch', () => {
  it('switching time off off removes the permission for everyone', async () => {
    await adminDb().execute(
      sql`update tenants set features = array_remove(features, 'timeoff') where id = ${alphaTenant}`,
    );
    const ctx = await loadTenantContext({ sub: owner.userId, role: 'authenticated' }, alphaTenant);
    expect(await code(requestLeave(ctx!, ask(annual, '2031-09-01', '2031-09-01')))).toBe(
      'FORBIDDEN',
    );
  });
});
