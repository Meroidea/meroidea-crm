import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { listRosterShifts } from '@/modules/roster/queries';
import { createRosterSchema, publishRosterSchema, saveShiftSchema } from '@/modules/roster/schemas';
import { createRoster, publishRoster, saveShift } from '@/modules/roster/service';
import {
  exportTimesheetPeriod,
  exportTimesheetWorkbook,
  getTimesheetPeriod,
} from '@/modules/timesheets/period';
import { dayEntrySchema } from '@/modules/timesheets/schemas';
import { decideEntries, saveDayEntry } from '@/modules/timesheets/service';
import type { TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;
// Monday 1 July 2024: a week long past, so every shift in it has finished.
const MONDAY = '2024-07-01';
const TUESDAY = '2024-07-02';

let alphaTenant: string;
let betaTenant: string;
let alphaUsers: string[];
let betaUsers: string[];
let owner: TenantContext;
let manager: TenantContext;
let member: TenantContext;
let outsider: TenantContext;
let mondayShift: string;

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (error: unknown) => (error instanceof AppError ? error.code : String(error)),
  );
const entry = (overrides: Record<string, unknown> = {}) =>
  dayEntrySchema.parse({
    userId: member.userId,
    date: MONDAY,
    start: '09:05',
    end: '17:40',
    breakMinutes: 30,
    ...overrides,
  });

beforeAll(async () => {
  const alpha = await createWorkspace(`Approve Alpha ${stamp}`, mail('approve-alpha'));
  const managerId = await addMember(alpha.tenantId, mail('approve-mgr'), 'Mia Manager', 'manager');
  const memberId = await addMember(alpha.tenantId, mail('approve-mem'), 'Max Member', 'member');
  const beta = await createWorkspace(`Approve Beta ${stamp}`, mail('approve-beta'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  alphaUsers = [alpha.ownerId, managerId, memberId];
  betaUsers = [beta.ownerId];
  owner = await contextFor(alpha.ownerId, alphaTenant);
  manager = await contextFor(managerId, alphaTenant);
  member = await contextFor(memberId, alphaTenant);
  outsider = await contextFor(beta.ownerId, betaTenant);

  const roster = await createRoster(
    owner,
    createRosterSchema.parse({ startsOn: MONDAY, span: 'week' }),
  );
  const shift = (userId: string, date: string) =>
    saveShift(
      owner,
      saveShiftSchema.parse({
        rosterId: roster.id,
        userId,
        date,
        startTime: '09:00',
        endTime: '17:30',
        breaks: [{ minutes: 30, paid: false }],
      }),
    );
  mondayShift = (await shift(memberId, MONDAY)).id;
  await shift(memberId, TUESDAY);
  await shift(managerId, MONDAY);
  await publishRoster(owner, publishRosterSchema.parse({ id: roster.id }));
  expect(await listRosterShifts(owner, roster.id)).toHaveLength(3);
}, 120_000);

afterAll(async () => {
  if (alphaTenant) await destroyWorkspace(alphaTenant, alphaUsers);
  if (betaTenant) await destroyWorkspace(betaTenant, betaUsers);
}, 60_000);

describe('who can approve time by day', () => {
  it('refuses a member the approval screen, typing time for the day, and the export', async () => {
    expect(await code(getTimesheetPeriod(member, MONDAY))).toBe('FORBIDDEN');
    expect(await code(saveDayEntry(member, entry({ shiftId: mondayShift })))).toBe('FORBIDDEN');
    expect(await code(exportTimesheetPeriod(member, MONDAY))).toBe('FORBIDDEN');
    expect(await code(exportTimesheetWorkbook(member, MONDAY))).toBe('FORBIDDEN');
  });

  it('shows a manager each rostered shift for the day with nothing recorded yet', async () => {
    const period = await getTimesheetPeriod(manager, MONDAY);
    expect(period).toMatchObject({ from: MONDAY, to: '2024-07-07', locked: false });
    expect(period.day.map((row) => [row.fullName, row.shift?.startTime, row.entry])).toEqual([
      ['Max Member', '09:00', null],
      ['Mia Manager', '09:00', null],
    ]);
  });

  it('never shows or touches another business’s shifts and time', async () => {
    const theirs = await getTimesheetPeriod(outsider, MONDAY);
    expect(theirs.day).toEqual([]);
    expect(theirs.summary).toEqual([]);
    // Their own person against our shift: the shift is not there for them.
    expect(
      await code(saveDayEntry(outsider, entry({ userId: outsider.userId, shiftId: mondayShift }))),
    ).toBe('NOT_FOUND');
    expect(await code(saveDayEntry(outsider, entry()))).toBe('NOT_FOUND');
  });
});

describe('recording what was worked against a shift', () => {
  let entryId: string;

  it('saves and approves in one step, tied to the shift', async () => {
    const saved = await saveDayEntry(manager, entry({ shiftId: mondayShift, approve: true }));
    entryId = saved.id;
    expect(saved.status).toBe('approved');
    const period = await getTimesheetPeriod(manager, MONDAY);
    const row = period.day.find((candidate) => candidate.fullName === 'Max Member');
    expect(row?.shift?.id).toBe(mondayShift);
    expect(row?.entry).toMatchObject({
      id: entryId,
      shiftId: mondayShift,
      startTime: '09:05',
      endTime: '17:40',
      workedMinutes: 485,
      status: 'approved',
      source: 'manual',
    });
  });

  it('refuses time against someone else’s shift, a future time, and a break as long as the work', async () => {
    expect(
      await code(saveDayEntry(owner, entry({ userId: manager.userId, shiftId: mondayShift }))),
    ).toBe('VALIDATION');
    expect(await code(saveDayEntry(owner, entry({ date: '2099-01-05' })))).toBe('VALIDATION');
    expect(
      await code(saveDayEntry(owner, entry({ start: '09:00', end: '09:30', breakMinutes: 30 }))),
    ).toBe('VALIDATION');
  });

  it('sends a corrected entry back to waiting unless it is approved again', async () => {
    const corrected = await saveDayEntry(owner, entry({ entryId, end: '18:00' }));
    expect(corrected).toEqual({ id: entryId, status: 'pending' });
    const period = await getTimesheetPeriod(owner, MONDAY);
    expect(period.summary.find((person) => person.fullName === 'Max Member')).toMatchObject({
      waiting: 1,
      approvedMinutes: 0,
      ready: false,
    });
    await decideEntries(owner, { ids: [entryId], decision: 'approved' });
  });

  it('writes an audit entry for each save', async () => {
    const rows = (await withRls(owner, (tx) =>
      tx.execute(sql`select action, context from audit_logs
                     where tenant_id = ${alphaTenant} and entity_type = 'time_entry'
                       and entity_id = ${entryId} order by created_at`),
    )) as unknown as { action: string }[];
    expect(rows.map((row) => row.action)).toEqual(['create', 'update', 'update']);
  });
});

describe('the pay period', () => {
  it('counts approved time, and flags a finished shift with no time against it', async () => {
    const period = await getTimesheetPeriod(owner, TUESDAY);
    expect(period.summary).toMatchObject([
      // Rostered twice for 8 hours; Monday approved at 8h25m; Tuesday has nothing recorded.
      {
        fullName: 'Max Member',
        rosteredMinutes: 960,
        approvedMinutes: 505,
        missing: 1,
        ready: false,
      },
      {
        fullName: 'Mia Manager',
        rosteredMinutes: 480,
        approvedMinutes: 0,
        missing: 1,
        ready: false,
      },
    ]);
  });

  it('exports only approved time, and records that it was exported', async () => {
    const file = await exportTimesheetPeriod(owner, MONDAY);
    expect(file.filename).toBe('timesheets-2024-07-01-to-2024-07-07.csv');
    expect(file.rows).toBe(1);
    const [header, line] = file.csv.split(/\r?\n/);
    expect(header).toContain('Name,Date,Start,Finish');
    expect(line).toContain('Max Member,2024-07-01,09:05,18:00,30,8.42');
    const audits = (await withRls(owner, (tx) =>
      tx.execute(sql`select context from audit_logs
                     where tenant_id = ${alphaTenant} and action = 'export'
                       and entity_type = 'time_entry'`),
    )) as unknown as { context: { entries: number } }[];
    expect(audits.at(-1)?.context.entries).toBe(1);
  });

  it('exports the same approved time as an Excel workbook, for this business only', async () => {
    const file = await exportTimesheetWorkbook(owner, MONDAY);
    expect(file.filename).toMatch(/^timesheets___2024-07-01_\d+\.xlsx$/);
    expect(file.rows).toBe(1);
    // A zip archive starts with the letters PK.
    expect(Buffer.from(file.base64, 'base64').subarray(0, 2).toString()).toBe('PK');
    expect((await exportTimesheetWorkbook(outsider, MONDAY)).rows).toBe(0);
  });
});
