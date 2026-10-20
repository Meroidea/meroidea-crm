import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { rosterShifts } from '@/db/schema';
import { AppError } from '@/lib/errors';
import {
  getRosterForDate,
  getRosterRules,
  listRemovedShifts,
  listRosterRates,
  listRosterShifts,
  listRosterTeams,
} from '@/modules/roster/queries';
import { DEFAULT_BREAK_RULES } from '@/modules/roster/rules';
import {
  addHolidaySchema,
  copyShiftSchema,
  createRosterSchema,
  publishRosterSchema,
  saveRulesSchema,
  saveShiftSchema,
  saveTeamSchema,
} from '@/modules/roster/schemas';
import {
  addHoliday,
  copyShift,
  createRoster,
  deleteRoster,
  deleteShift,
  deleteTeam,
  publishRoster,
  saveRules,
  saveShift,
  saveTeam,
  unpublishRoster,
} from '@/modules/roster/service';
import type { TenantContext } from '@/server/context';
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
    breaks: [{ minutes: 30, paid: false }],
    ...overrides,
  });

const publish = (id: string, options: Record<string, unknown> = {}) =>
  publishRosterSchema.parse({ id, ...options });

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
      breakMinutes: 30,
      published: false,
      unpublishedChanges: true,
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
    await expectCode(() => publishRoster(member, publish(rosterId)), 'FORBIDDEN');
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
    await publishRoster(owner, publish(rosterId));
    const seen = await getRosterForDate(member, '2031-03-05');
    expect(seen).toMatchObject({ id: rosterId, status: 'published' });
    expect(await listRosterShifts(member, rosterId)).toHaveLength(1);

    await unpublishRoster(owner, rosterId);
    expect(await getRosterForDate(member, '2031-03-05')).toBeNull();
    expect(await listRosterShifts(member, rosterId)).toHaveLength(0);
    await publishRoster(owner, publish(rosterId));
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
      }),
    );
    await publishRoster(owner, publish(rosterId));
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
    await expectCode(() => publishRoster(outsider, publish(rosterId)), 'NOT_FOUND');
  });
});

describe('teams, vacant shifts and breaks', () => {
  let teamId: string;

  it('lets the owner create a team, and only its members can be rostered into it', async () => {
    teamId = (
      await saveTeam(
        owner,
        saveTeamSchema.parse({ name: 'Floor', color: 'chart-1', memberIds: [member.userId] }),
      )
    ).id;
    const inTeam = await saveShift(
      owner,
      shift(member, { date: '2031-03-04', teamId, breaks: [] }),
    );
    expect(
      (await listRosterShifts(owner, rosterId)).find((row) => row.id === inTeam.id),
    ).toMatchObject({ teamId });
    await expectCode(
      () => saveShift(owner, shift(manager, { date: '2031-03-04', teamId, breaks: [] })),
      'VALIDATION',
    );
    await deleteShift(owner, inTeam.id);
  });

  it('refuses a second team with the same name, whatever the capitals', async () => {
    await expectCode(
      () => saveTeam(owner, saveTeamSchema.parse({ name: 'FLOOR', color: 'chart-2' })),
      'DUPLICATE',
    );
  });

  it('refuses a member or a manager who tries to change teams or pay rules', async () => {
    for (const ctx of [member, manager]) {
      await expectCode(
        () => saveTeam(ctx, saveTeamSchema.parse({ name: 'Mine', color: 'chart-2' })),
        'FORBIDDEN',
      );
      await expectCode(() => deleteTeam(ctx, teamId), 'FORBIDDEN');
      await expectCode(
        () => saveRules(ctx, saveRulesSchema.parse({ saturday: 1, sunday: 2, publicHoliday: 2.5 })),
        'FORBIDDEN',
      );
      await expectCode(
        () => addHoliday(ctx, addHolidaySchema.parse({ day: '2031-03-05', name: 'A day off' })),
        'FORBIDDEN',
      );
    }
    const message = await rejectionMessage(() =>
      withRls(member, (tx) =>
        tx.execute(
          sql`insert into roster_teams (tenant_id, name) values (${alphaTenant}, 'Sneaky')`,
        ),
      ),
    );
    expect(message).toMatch(/row-level security/i);
  });

  it('shows a member which teams they are in, but not who else is', async () => {
    await saveTeam(
      owner,
      saveTeamSchema.parse({
        id: teamId,
        name: 'Floor',
        color: 'chart-1',
        memberIds: [member.userId, manager.userId],
      }),
    );
    const seenByMember = await listRosterTeams(member);
    expect(seenByMember.find((team) => team.id === teamId)?.memberIds).toEqual([member.userId]);
    // The manager reads the whole roster, so sees the whole team.
    const seenByManager = await listRosterTeams(manager);
    expect(seenByManager.find((team) => team.id === teamId)?.memberIds.sort()).toEqual(
      [member.userId, manager.userId].sort(),
    );
  });

  it('never shows or changes another workspace’s teams, rules or holidays', async () => {
    await saveRules(
      owner,
      saveRulesSchema.parse({ saturday: 1.25, sunday: 1.5, publicHoliday: 2.5, breakRules: [] }),
    );
    await addHoliday(owner, addHolidaySchema.parse({ day: '2031-03-07', name: 'Founders day' }));

    expect(await listRosterTeams(outsider)).toHaveLength(0);
    expect(await getRosterRules(outsider)).toEqual({
      loadings: { saturday: 1, sunday: 1, publicHoliday: 1 },
      breakRules: DEFAULT_BREAK_RULES,
      holidays: [],
    });
    await expectCode(() => deleteTeam(outsider, teamId), 'NOT_FOUND');
    await expectCode(
      () =>
        saveTeam(
          outsider,
          saveTeamSchema.parse({ name: 'Theirs', color: 'chart-3', memberIds: [member.userId] }),
        ),
      'VALIDATION',
    );
    const raw = (await withRls(outsider, (tx) =>
      tx.execute(sql`select
        (select count(*)::int from roster_teams) as teams,
        (select count(*)::int from roster_team_members) as members,
        (select count(*)::int from workforce_settings) as settings,
        (select count(*)::int from public_holidays) as holidays`),
    )) as unknown as Record<string, number>[];
    expect(raw[0]).toEqual({ teams: 0, members: 0, settings: 0, holidays: 0 });

    const own = await getRosterRules(member);
    expect(own.loadings).toEqual({ saturday: 1.25, sunday: 1.5, publicHoliday: 2.5 });
    expect(own.holidays.map((holiday) => holiday.day)).toEqual(['2031-03-07']);
  });

  it('keeps pay rates from anyone who does not manage employee records', async () => {
    expect(await listRosterRates(member)).toBeNull();
    expect(await listRosterRates(manager)).toBeNull();
    expect(await listRosterRates(owner)).toEqual({});
  });

  it('saves a vacant shift, and takes only unpaid breaks off the hours worked', async () => {
    const vacant = await saveShift(
      owner,
      shift(member, {
        userId: '',
        date: '2031-03-05',
        startTime: '09:00',
        endTime: '17:00',
        breaks: [
          { minutes: 30, paid: false },
          { minutes: 10, paid: true },
        ],
      }),
    );
    const saved = (await listRosterShifts(owner, rosterId)).find((row) => row.id === vacant.id);
    expect(saved).toMatchObject({ userId: null, breakMinutes: 30, paidMinutes: 450 });
    expect(saved?.breaks).toHaveLength(2);

    // Two vacant shifts at the same time are fine: nobody is double-booked.
    const copied = await copyShift(
      owner,
      copyShiftSchema.parse({ id: vacant.id, dates: ['2031-03-07', '2031-03-08'] }),
    );
    expect(copied.created).toBe(2);
    await expectCode(
      () => copyShift(owner, copyShiftSchema.parse({ id: vacant.id, dates: ['2031-03-20'] })),
      'VALIDATION',
    );
    await expectCode(
      () => copyShift(member, copyShiftSchema.parse({ id: vacant.id, dates: ['2031-03-09'] })),
      'FORBIDDEN',
    );
    for (const row of await listRosterShifts(owner, rosterId)) {
      if (row.userId === null) await deleteShift(owner, row.id);
    }
  });
});

describe('publishing shift by shift', () => {
  it('keeps a shift added to a published roster from staff until it is published', async () => {
    await publishRoster(owner, publish(rosterId));
    const before = await listRosterShifts(member, rosterId);

    const added = await saveShift(
      owner,
      shift(member, { date: '2031-03-08', startTime: '08:00', endTime: '12:00', breaks: [] }),
    );
    expect((await listRosterShifts(member, rosterId)).map((row) => row.id)).toEqual(
      before.map((row) => row.id),
    );
    // Straight at the database, past the service: the new shift is not there for them either.
    const raw = await withRls(member, (tx) =>
      tx.select({ id: rosterShifts.id }).from(rosterShifts),
    );
    expect(raw.map((row) => row.id)).not.toContain(added.id);
    // Nor for a manager, who reads everyone's published shifts but does not build the roster.
    expect((await listRosterShifts(manager, rosterId)).map((row) => row.id)).not.toContain(
      added.id,
    );

    const outcome = await publishRoster(owner, publish(rosterId));
    expect(outcome.published).toBe(1);
    expect((await listRosterShifts(member, rosterId)).map((row) => row.id)).toContain(added.id);
  });

  it('marks a published shift as changed when it is edited, and clears that on publish', async () => {
    const [target] = (await listRosterShifts(owner, rosterId)).filter(
      (row) => row.date === '2031-03-08',
    );
    if (!target) throw new Error('no shift to change');
    expect(target).toMatchObject({ published: true, unpublishedChanges: false });
    await saveShift(
      owner,
      shift(member, {
        id: target.id,
        date: '2031-03-08',
        startTime: '08:00',
        endTime: '13:00',
        breaks: [],
      }),
    );
    const changed = (await listRosterShifts(owner, rosterId)).find((row) => row.id === target.id);
    expect(changed).toMatchObject({ published: true, unpublishedChanges: true });

    await publishRoster(owner, publish(rosterId));
    const settled = (await listRosterShifts(owner, rosterId)).find((row) => row.id === target.id);
    expect(settled).toMatchObject({ published: true, unpublishedChanges: false });
  });

  it('remembers a removed published shift until its removal has been published', async () => {
    const [target] = (await listRosterShifts(owner, rosterId)).filter(
      (row) => row.date === '2031-03-08',
    );
    if (!target) throw new Error('no shift to remove');
    await deleteShift(owner, target.id);
    const waiting = await listRemovedShifts(owner, rosterId);
    expect(waiting.map((row) => row.id)).toEqual([target.id]);
    await expectCode(() => listRemovedShifts(member, rosterId), 'FORBIDDEN');

    const outcome = await publishRoster(owner, publish(rosterId, { notify: true, scope: 'all' }));
    // Tests never send mail, so the outcome reports that nobody was emailed.
    expect(outcome).toMatchObject({ published: 1, emailed: 0 });
    expect(await listRemovedShifts(owner, rosterId)).toHaveLength(0);
  });

  it('tells the person a published shift was taken from when it is given to someone else', async () => {
    const { id } = await saveShift(owner, shift(member, { date: '2031-03-09' }));
    await publishRoster(owner, publish(rosterId));
    const moved = await saveShift(owner, shift(manager, { id, date: '2031-03-09' }));
    // The member's shift waits to be published as removed, so they are told; the manager has
    // a new one.
    expect((await listRemovedShifts(owner, rosterId)).map((row) => row.id)).toEqual([id]);
    expect(moved.id).not.toBe(id);
    const now = (await listRosterShifts(owner, rosterId)).find((row) => row.id === moved.id);
    expect(now).toMatchObject({ userId: manager.userId, date: '2031-03-09' });

    await deleteShift(owner, moved.id);
    await publishRoster(owner, publish(rosterId));
  });

  it('forgets a shift that was removed before anyone was shown it', async () => {
    const draft = await saveShift(
      owner,
      shift(member, { date: '2031-03-09', startTime: '08:00', endTime: '12:00', breaks: [] }),
    );
    await deleteShift(owner, draft.id);
    expect(await listRemovedShifts(owner, rosterId)).toHaveLength(0);
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
    await saveShift(owner, shift(manager, { startTime: '16:00', endTime: '20:00', breaks: [] }));
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
            breaks: [{ minutes: 60, paid: false }],
          }),
        ),
      'VALIDATION',
    );
  });

  it('treats an end time before the start as running overnight', async () => {
    await saveShift(
      owner,
      shift(member, { date: '2031-03-06', startTime: '22:00', endTime: '06:00', breaks: [] }),
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

  it('copies without double-booking anyone, and without keeping a team the person has left', async () => {
    const source = await getRosterForDate(owner, '2031-03-10');
    if (!source) throw new Error('no roster to copy');
    const inSource = (ctx: TenantContext, overrides: Record<string, unknown>) =>
      saveShift(owner, shift(ctx, { rosterId: source.id, breaks: [], ...overrides }));
    // Sunday night runs into the next roster's Monday, where the copied Monday shift starts.
    await inSource(member, { date: '2031-03-16', startTime: '22:00', endTime: '06:00' });
    await inSource(member, { date: '2031-03-10', startTime: '05:00', endTime: '13:00' });
    // A shift kept in a team the person is not in (written past the service, as old data could be).
    const [floor] = (await adminDb().execute(sql`
      select id from roster_teams where tenant_id = ${alphaTenant} and name = 'Floor'
        and deleted_at is null`)) as unknown as { id: string }[];
    const ownerShift = await inSource(owner, { date: '2031-03-11' });
    await adminDb().execute(
      sql`update roster_shifts set team_id = ${floor!.id} where id = ${ownerShift.id}`,
    );

    const copy = await createRoster(
      owner,
      createRosterSchema.parse({ startsOn: '2031-03-17', span: 'week', copyPrevious: true }),
    );
    expect(copy).toMatchObject({ copiedShifts: 2, skippedShifts: 1 });
    const copied = (await adminDb().execute(sql`
      select user_id, team_id, to_char(starts_at at time zone ${owner.tenant.timezone}, 'YYYY-MM-DD HH24:MI') as starts
      from roster_shifts where roster_id = ${copy.id} order by starts_at`)) as unknown as {
      user_id: string;
      team_id: string | null;
      starts: string;
    }[];
    expect(copied).toEqual([
      { user_id: owner.userId, team_id: null, starts: '2031-03-18 09:00' },
      { user_id: member.userId, team_id: null, starts: '2031-03-23 22:00' },
    ]);
  });

  it('writes an audit entry for creating a roster and for every publish', async () => {
    const rows = (await withRls(owner, (tx) =>
      tx.execute(sql`select action, context from audit_logs
                     where tenant_id = ${alphaTenant} and entity_type = 'roster'
                       and entity_id = ${rosterId} order by created_at`),
    )) as unknown as { action: string; context: { publishedShifts?: number } | null }[];
    expect(rows[0]?.action).toBe('create');
    expect(rows.slice(1).every((row) => row.action === 'update')).toBe(true);
    // Every publish records how many shifts it showed to staff.
    expect(
      rows.filter((row) => typeof row.context?.publishedShifts === 'number').length,
    ).toBeGreaterThanOrEqual(5);
  });
});
