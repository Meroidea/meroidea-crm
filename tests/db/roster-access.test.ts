import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { rosterShifts } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { getRosterForDate, listRosterShifts } from '@/modules/roster/queries';
import { createRosterSchema, saveShiftSchema } from '@/modules/roster/schemas';
import {
  createRoster,
  deleteRoster,
  deleteShift,
  publishRoster,
  saveShift,
  unpublishRoster,
} from '@/modules/roster/service';
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
let manager: TenantContext;
let member: TenantContext;
let outsider: TenantContext;
let rosterId: string;

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

async function rejectionMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const wrapped = error as { message?: string; cause?: { message?: string } };
    return `${wrapped.message ?? ''} ${wrapped.cause?.message ?? ''}`;
  }
  throw new Error('expected the query to be rejected');
}

const shift = (ctx: TenantContext, overrides: Record<string, unknown> = {}) =>
  saveShiftSchema.parse({
    rosterId,
    userId: ctx.userId,
    date: '2031-03-03',
    startTime: '09:00',
    endTime: '17:00',
    breakMinutes: 30,
    position: 'Front desk',
    ...overrides,
  });

beforeAll(async () => {
  const alpha = await createWorkspace('Roster Alpha', mail('roster-alpha'));
  const managerId = await addMember(alpha.tenantId, mail('roster-mgr'), 'Mia Manager', 'manager');
  const memberId = await addMember(alpha.tenantId, mail('roster-mem'), 'Max Member', 'member');
  const beta = await createWorkspace('Roster Beta', mail('roster-beta'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  alphaUsers = [alpha.ownerId, managerId, memberId];
  betaUsers = [beta.ownerId];
  owner = await contextFor(alpha.ownerId, alphaTenant);
  manager = await contextFor(managerId, alphaTenant);
  member = await contextFor(memberId, alphaTenant);
  outsider = await contextFor(beta.ownerId, betaTenant);

  // Monday 3 March 2031, far from any roster a developer might create by hand.
  const created = await createRoster(
    owner,
    createRosterSchema.parse({ startsOn: '2031-03-03', span: 'week' }),
  );
  rosterId = created.id;
}, 120_000);

afterAll(async () => {
  if (alphaTenant) await destroyWorkspace(alphaTenant, alphaUsers);
  if (betaTenant) await destroyWorkspace(betaTenant, betaUsers);
}, 60_000);

describe('who can build a roster', () => {
  it('lets the owner create a weekly roster and add a shift to it', async () => {
    const saved = await saveShift(owner, shift(member));
    const shifts = await listRosterShifts(owner, rosterId);
    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toMatchObject({
      id: saved.id,
      userId: member.userId,
      date: '2031-03-03',
      startTime: '09:00',
      endTime: '17:00',
      overnight: false,
      paidMinutes: 450,
      position: 'Front desk',
    });
  });

  it('creates a fortnightly roster that runs fourteen days', async () => {
    await createRoster(
      owner,
      createRosterSchema.parse({ startsOn: '2031-04-07', span: 'fortnight' }),
    );
    const roster = await getRosterForDate(owner, '2031-04-20');
    expect(roster).toMatchObject({ startsOn: '2031-04-07', endsOn: '2031-04-20', status: 'draft' });
    expect(await getRosterForDate(owner, '2031-04-21')).toBeNull();
  });

  it('refuses a member who tries to create a roster', async () => {
    await expectCode(
      () =>
        createRoster(member, createRosterSchema.parse({ startsOn: '2031-05-05', span: 'week' })),
      'FORBIDDEN',
    );
  });

  it('refuses a manager too: only someone holding rosters.manage may create one', async () => {
    await expectCode(
      () =>
        createRoster(manager, createRosterSchema.parse({ startsOn: '2031-05-05', span: 'week' })),
      'FORBIDDEN',
    );
  });

  it('refuses a member who tries to add, change or delete a shift, or publish', async () => {
    const [existing] = await listRosterShifts(owner, rosterId);
    if (!existing) throw new Error('no shift to work with');
    await expectCode(() => saveShift(member, shift(member, { date: '2031-03-04' })), 'FORBIDDEN');
    await expectCode(
      () => saveShift(member, shift(member, { id: existing.id, endTime: '12:00' })),
      'FORBIDDEN',
    );
    await expectCode(() => deleteShift(member, existing.id), 'FORBIDDEN');
    await expectCode(() => publishRoster(member, rosterId), 'FORBIDDEN');
    await expectCode(() => deleteRoster(member, rosterId), 'FORBIDDEN');
  });

  it('is refused by the database itself when a member writes past the service', async () => {
    const message = await rejectionMessage(() =>
      withRls(member, (tx) =>
        tx.execute(sql`insert into rosters (tenant_id, starts_on, ends_on)
                       values (${alphaTenant}, '2031-06-02', '2031-06-08')`),
      ),
    );
    expect(message).toMatch(/row-level security/i);

    // An update the member is not allowed to make matches no rows rather than raising.
    await withRls(member, (tx) =>
      tx.execute(sql`update roster_shifts set break_minutes = 0 where roster_id = ${rosterId}`),
    );
    const [untouched] = await listRosterShifts(owner, rosterId);
    expect(untouched?.breakMinutes).toBe(30);
  });
});

describe('who can see a roster', () => {
  it('hides a draft from a member, in the service and in the database', async () => {
    expect(await getRosterForDate(member, '2031-03-03')).toBeNull();
    const rows = (await withRls(member, (tx) =>
      tx.execute(sql`select
        (select count(*)::int from rosters where id = ${rosterId}) as rosters,
        (select count(*)::int from roster_shifts where roster_id = ${rosterId}) as shifts`),
    )) as unknown as { rosters: number; shifts: number }[];
    expect(rows[0]).toEqual({ rosters: 0, shifts: 0 });
  });

  it('shows it to a member once published, and hides it again when moved back to draft', async () => {
    await publishRoster(owner, rosterId);
    const seen = await getRosterForDate(member, '2031-03-05');
    expect(seen).toMatchObject({ id: rosterId, status: 'published' });
    expect(await listRosterShifts(member, rosterId)).toHaveLength(1);

    await unpublishRoster(owner, rosterId);
    expect(await getRosterForDate(member, '2031-03-05')).toBeNull();
    expect(await listRosterShifts(member, rosterId)).toHaveLength(0);
    await publishRoster(owner, rosterId);
  });

  it("general staff see only their own shifts; managers and the owner see everyone's", async () => {
    const other = await saveShift(
      owner,
      saveShiftSchema.parse({
        rosterId,
        userId: manager.userId,
        date: '2031-03-06',
        startTime: '10:00',
        endTime: '14:00',
        breakMinutes: 0,
      }),
    );
    const mine = await listRosterShifts(member, rosterId);
    expect(mine.map((row) => row.userId)).toEqual([member.userId]);
    // Straight at the database, past the service: still only their own.
    const raw = await withRls(member, (tx) =>
      tx.select({ userId: rosterShifts.userId }).from(rosterShifts),
    );
    expect(raw.every((row) => row.userId === member.userId)).toBe(true);
    expect(raw.length).toBeGreaterThan(0);

    expect(await listRosterShifts(manager, rosterId)).toHaveLength(2);
    expect(await listRosterShifts(owner, rosterId)).toHaveLength(2);
    await deleteShift(owner, other.id);
  });

  it('never shows another workspace’s roster, even when published', async () => {
    expect(await getRosterForDate(outsider, '2031-03-03')).toBeNull();
    expect(await listRosterShifts(outsider, rosterId)).toHaveLength(0);
    await expectCode(() => saveShift(outsider, shift(outsider)), 'NOT_FOUND');
    await expectCode(() => publishRoster(outsider, rosterId), 'NOT_FOUND');
  });
});

describe('roster rules', () => {
  it('refuses a second roster over days that are already covered', async () => {
    await expectCode(
      () => createRoster(owner, createRosterSchema.parse({ startsOn: '2031-03-08', span: 'week' })),
      'CONFLICT',
    );
  });

  it('refuses a shift that overlaps the same person’s other shift', async () => {
    await expectCode(
      () => saveShift(owner, shift(member, { startTime: '16:00', endTime: '20:00' })),
      'CONFLICT',
    );
    // Someone else at the same time is fine.
    await saveShift(
      owner,
      shift(manager, { startTime: '16:00', endTime: '20:00', breakMinutes: 0 }),
    );
  });

  it('refuses a shift outside the roster, for a non-member, or with a break as long as itself', async () => {
    await expectCode(() => saveShift(owner, shift(member, { date: '2031-03-10' })), 'VALIDATION');
    await expectCode(() => saveShift(owner, shift(outsider, { date: '2031-03-04' })), 'VALIDATION');
    await expectCode(
      () =>
        saveShift(
          owner,
          shift(member, {
            date: '2031-03-04',
            startTime: '09:00',
            endTime: '10:00',
            breakMinutes: 60,
          }),
        ),
      'VALIDATION',
    );
  });

  it('treats an end time before the start as running overnight', async () => {
    await saveShift(
      owner,
      shift(member, { date: '2031-03-06', startTime: '22:00', endTime: '06:00', breakMinutes: 0 }),
    );
    const overnight = (await listRosterShifts(owner, rosterId)).find(
      (candidate) => candidate.date === '2031-03-06',
    );
    expect(overnight).toMatchObject({ overnight: true, endTime: '06:00', paidMinutes: 480 });
  });

  it('copies the previous roster’s shifts day for day into a new one', async () => {
    const copy = await createRoster(
      owner,
      createRosterSchema.parse({ startsOn: '2031-03-10', span: 'week', copyPrevious: true }),
    );
    expect(copy.copiedShifts).toBe(3);
    const copied = await listRosterShifts(owner, copy.id);
    expect(
      copied.map((candidate) => [candidate.date, candidate.startTime, candidate.endTime]),
    ).toEqual([
      ['2031-03-10', '09:00', '17:00'],
      ['2031-03-10', '16:00', '20:00'],
      ['2031-03-13', '22:00', '06:00'],
    ]);
  });

  it('removes a deleted roster and its shifts, and frees its days', async () => {
    const roster = await getRosterForDate(owner, '2031-03-10');
    if (!roster) throw new Error('no roster to delete');
    await deleteRoster(owner, roster.id);
    expect(await getRosterForDate(owner, '2031-03-10')).toBeNull();
    expect(await listRosterShifts(owner, roster.id)).toHaveLength(0);
    await createRoster(owner, createRosterSchema.parse({ startsOn: '2031-03-10', span: 'week' }));
  });

  it('writes an audit entry for creating and publishing a roster', async () => {
    const rows = (await withRls(owner, (tx) =>
      tx.execute(sql`select action from audit_logs
                     where tenant_id = ${alphaTenant} and entity_type = 'roster'
                       and entity_id = ${rosterId} order by created_at`),
    )) as unknown as { action: string }[];
    expect(rows.map((row) => row.action)).toEqual(['create', 'update', 'update', 'update']);
  });
});
