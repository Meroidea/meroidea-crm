import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { listLeaveTypes } from '@/modules/timeoff/queries';
import { requestLeaveSchema } from '@/modules/timeoff/schemas';
import { decideLeave, requestLeave } from '@/modules/timeoff/service';
import { manualEntrySchema } from '@/modules/timesheets/schemas';
import { decideEntries, saveManualEntry } from '@/modules/timesheets/service';
import type { TenantContext } from '@/server/context';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

/*
 * Hours and leave set a person's pay, so whoever approves them must be someone else, as with
 * expenses. A manager cannot approve their own; the Admin, who answers to no one, may.
 */

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let tenantId: string;
let userIds: string[];
let owner: TenantContext;
let manager: TenantContext;
let member: TenantContext;
let annual: string;

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (error: unknown) => (error instanceof AppError ? error.code : String(error)),
  );

const manual = (date: string) =>
  manualEntrySchema.parse({ date, start: '09:00', end: '17:00', breakMinutes: 30, note: '' });

const ask = (startsOn: string) =>
  requestLeaveSchema.parse({
    leaveTypeId: annual,
    startsOn,
    endsOn: startsOn,
    days: '1',
    note: '',
  });

beforeAll(async () => {
  const workspace = await createWorkspace(`Sign-off ${stamp}`, mail('signoff-owner'));
  tenantId = workspace.tenantId;
  const managerId = await addMember(tenantId, mail('signoff-manager'), 'Mia Manager', 'manager');
  const memberId = await addMember(tenantId, mail('signoff-member'), 'Max Member', 'member');
  userIds = [workspace.ownerId, managerId, memberId];
  owner = await contextFor(workspace.ownerId, tenantId);
  manager = await contextFor(managerId, tenantId);
  member = await contextFor(memberId, tenantId);
  annual = (await listLeaveTypes(owner)).find((type) => type.name === 'Annual leave')!.id;
}, 60_000);

afterAll(async () => {
  if (tenantId) await destroyWorkspace(tenantId, userIds);
}, 60_000);

describe('approving hours', () => {
  it('a manager cannot approve their own time, but approves a colleague’s', async () => {
    const own = await saveManualEntry(manager, manual('2024-06-03'));
    expect(await code(decideEntries(manager, { ids: [own.id], decision: 'approved' }))).toBe(
      'CONFLICT',
    );
    const theirs = await saveManualEntry(member, manual('2024-06-03'));
    expect(await code(decideEntries(manager, { ids: [theirs.id], decision: 'approved' }))).toBe(
      'OK',
    );
    // Someone else signs the manager's time off.
    expect(await code(decideEntries(owner, { ids: [own.id], decision: 'approved' }))).toBe('OK');
  });

  it('the Admin may approve their own', async () => {
    const own = await saveManualEntry(owner, manual('2024-06-04'));
    expect(await code(decideEntries(owner, { ids: [own.id], decision: 'approved' }))).toBe('OK');
  });
});

describe('approving leave', () => {
  it('a manager cannot approve their own leave; someone else can', async () => {
    const own = await requestLeave(manager, ask('2031-05-05'));
    expect(await code(decideLeave(manager, { id: own.id, decision: 'approved', note: null }))).toBe(
      'CONFLICT',
    );
    expect(await code(decideLeave(owner, { id: own.id, decision: 'approved', note: null }))).toBe(
      'OK',
    );
  });
});
