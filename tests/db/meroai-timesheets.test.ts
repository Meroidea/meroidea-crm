import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addDaysToDate, mondayOf, zonedDateTimeToInstant, zonedToday } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { authoriseTimesheets, prepareTimesheetAuthorisation } from '@/modules/ai/meroai-timesheets';
import { timesheetAuthoriseSchema } from '@/modules/ai/schemas';
import type { AuthoriseRow } from '@/modules/ai/timesheet-planner';
import { publishRosterSchema, saveRulesSchema } from '@/modules/roster/schemas';
import { createRoster, publishRoster, saveRules, saveShift } from '@/modules/roster/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

// "Authorise with MeroAI" on the timesheets pay period (ADR-082), against the real database and
// RLS: clock times when both were recorded, roster times otherwise, breaks by the business's
// rules; nothing approved until the manager authorises; another business and staff kept out.

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

let alphaTenant: string;
let betaTenant: string;
const alphaUsers: string[] = [];
const betaUsers: string[] = [];
let owner: TenantContext;
let staff: TenantContext;
let betaOwner: TenantContext;
let samId: string;
let kimId: string;
let kimEntryId: string;
let monday: string;
let prepared: AuthoriseRow[];

beforeAll(async () => {
  const a = await createWorkspace('Alpha Kitchen', mail('ts-alpha'));
  alphaTenant = a.tenantId;
  samId = await addMember(alphaTenant, mail('ts-sam'), 'Sam Staff', 'member');
  kimId = await addMember(alphaTenant, mail('ts-kim'), 'Kim Cook', 'member');
  alphaUsers.push(a.ownerId, samId, kimId);
  owner = await contextFor(a.ownerId, alphaTenant);
  staff = await contextFor(samId, alphaTenant);

  const b = await createWorkspace('Beta Kitchen', mail('ts-beta'));
  betaTenant = b.tenantId;
  betaUsers.push(b.ownerId);
  betaOwner = await contextFor(b.ownerId, betaTenant);

  // The owner's tiers: longer than 5h, 30 unpaid and 10 paid; longer than 8h, 60 and 20 in all.
  await saveRules(
    owner,
    saveRulesSchema.parse({
      saturday: 1,
      sunday: 1,
      publicHoliday: 1,
      breakRules: [
        { fromMinutes: 300, minutes: 30, paid: false },
        { fromMinutes: 300, minutes: 10, paid: true },
        { fromMinutes: 480, minutes: 30, paid: false },
        { fromMinutes: 480, minutes: 10, paid: true },
      ],
    }),
  );

  // A week that has been worked: two weeks back.
  monday = addDaysToDate(mondayOf(zonedToday(owner.tenant.timezone)), -14);
  const roster = await createRoster(owner, { startsOn: monday, span: 'week', copyPrevious: false });
  const shift = (userId: string, startTime: string, endTime: string) =>
    saveShift(owner, {
      rosterId: roster.id,
      userId,
      teamId: null,
      date: monday,
      startTime,
      endTime,
      breaks: [],
      autoBreaks: false,
      note: null,
    });
  await shift(samId, '10:00', '17:30');
  const kimShift = await shift(kimId, '10:00', '20:30');
  await publishRoster(owner, publishRosterSchema.parse({ id: roster.id }));

  // Kim clocked in and out; Sam forgot to.
  const timezone = owner.tenant.timezone;
  const [entry] = await rows<{ id: string }>(sql`
    insert into time_entries (tenant_id, user_id, shift_id, clock_in, clock_out, break_minutes, source, status)
    values (${alphaTenant}, ${kimId}, ${kimShift.id},
      ${zonedDateTimeToInstant(timezone, monday, '10:05').toISOString()},
      ${zonedDateTimeToInstant(timezone, monday, '20:40').toISOString()}, 0, 'clock', 'pending')
    returning id`);
  kimEntryId = entry!.id;
}, 180_000);

afterAll(async () => {
  if (alphaTenant) await destroyWorkspace(alphaTenant, alphaUsers);
  if (betaTenant) await destroyWorkspace(betaTenant, betaUsers);
}, 60_000);

describe('MeroAI prepares the pay period', () => {
  it('uses the clock where both times were recorded and the roster where not, with breaks by the rules', async () => {
    const result = await prepareTimesheetAuthorisation(owner, monday);
    prepared = result.rows;
    const sam = prepared.find((row) => row.userId === samId);
    const kim = prepared.find((row) => row.userId === kimId);
    expect(sam).toMatchObject({
      basis: 'roster',
      start: '10:00',
      end: '17:30',
      unpaidMinutes: 30,
      paidBreakMinutes: 10,
      workedMinutes: 420,
      status: 'ready',
      entryId: null,
    });
    expect(kim).toMatchObject({
      basis: 'clock',
      start: '10:05',
      end: '20:40',
      unpaidMinutes: 60,
      paidBreakMinutes: 20,
      workedMinutes: 575,
      status: 'ready',
      entryId: kimEntryId,
    });
  });

  it('approves nothing by itself', async () => {
    const [count] = await rows<{ n: number }>(sql`
      select count(*)::int as n from time_entries where tenant_id = ${alphaTenant} and status = 'approved'`);
    expect(count?.n).toBe(0);
  });

  it('staff without timesheets.manage cannot prepare, and another business sees none of it', async () => {
    await expectCode(() => prepareTimesheetAuthorisation(staff, monday), 'FORBIDDEN');
    const foreign = await prepareTimesheetAuthorisation(betaOwner, monday);
    expect(foreign.rows).toEqual([]);
  });
});

describe('the manager authorises', () => {
  const toInput = (list: AuthoriseRow[], change: Partial<{ breakMinutes: number }> = {}) =>
    timesheetAuthoriseSchema.parse({
      rows: list.map((row) => ({
        key: row.key,
        userId: row.userId,
        shiftId: row.shiftId,
        entryId: row.entryId,
        date: row.date,
        start: row.start,
        end: row.end,
        breakMinutes: change.breakMinutes ?? row.unpaidMinutes,
      })),
    });

  it('another business cannot authorise this business’s time', async () => {
    const result = await authoriseTimesheets(betaOwner, toInput(prepared));
    expect(result.approved).toBe(0);
    expect(result.skipped).toHaveLength(prepared.length);
    const [count] = await rows<{ n: number }>(sql`
      select count(*)::int as n from time_entries where tenant_id = ${alphaTenant} and status = 'approved'`);
    expect(count?.n).toBe(0);
  });

  it('staff without timesheets.manage cannot authorise', async () => {
    await expectCode(() => authoriseTimesheets(staff, toInput(prepared)), 'FORBIDDEN');
  });

  it('approves every reviewed row through the timesheet service, with the breaks as reviewed', async () => {
    const result = await authoriseTimesheets(owner, toInput(prepared));
    expect(result).toEqual({ approved: 2, skipped: [] });
    const entries = await rows<{
      user_id: string;
      break_minutes: number;
      status: string;
      source: string;
    }>(sql`
      select user_id, break_minutes, status, source from time_entries
      where tenant_id = ${alphaTenant} and deleted_at is null order by user_id`);
    expect(entries).toHaveLength(2);
    const byUser = Object.fromEntries(entries.map((entry) => [entry.user_id, entry]));
    expect(byUser[samId]).toMatchObject({
      break_minutes: 30,
      status: 'approved',
      source: 'manual',
    });
    expect(byUser[kimId]).toMatchObject({ break_minutes: 60, status: 'approved', source: 'clock' });
  });

  it('a second look shows them approved and leaves them alone', async () => {
    const again = await prepareTimesheetAuthorisation(owner, monday);
    expect(again.rows.every((row) => row.status === 'approved')).toBe(true);
  });
});
