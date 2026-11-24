import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { addDaysToDate, mondayOf, zonedToday } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import {
  buildRosterWithAgent,
  checkRoster,
  instantBuild,
  planVacantFill,
} from '@/modules/ai/roster-agent';
import { chatAboutRoster } from '@/modules/ai/roster-chat';
import { rosterAgentBuildSchema, rosterChatSchema } from '@/modules/ai/schemas';
import { approveRosterPreview } from '@/modules/ai/service';
import { listRosterShifts } from '@/modules/roster/queries';
import { removeShiftsSchema } from '@/modules/roster/schemas';
import { createRoster, reassignShift, removeShifts, saveShift } from '@/modules/roster/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

// The roster agent (ADR-079) against the real database and RLS: building from recent weeks,
// replacing what is there, Instant build, the check, removing and reassigning shifts, and the
// chat's proposals. Only the model is replaced; nothing here may reach Google.

const model = vi.hoisted(() => ({
  call: null as null | { name: string; args: Record<string, unknown> },
}));

vi.mock('@/server/ai', () => {
  const modelFor = (tier: string) => (tier === 'reasoning' ? 'test-reasoning' : 'test-fast');
  return {
    isAiConfigured: () => true,
    modelFor,
    aiService: {
      isConfigured: () => true,
      modelFor,
      responseText: () => '',
      generate: async () => ({
        model: 'test-reasoning',
        fellBack: false,
        response: model.call
          ? {
              functionCalls: [{ id: 'call-1', ...model.call }],
              candidates: [{ content: { role: 'model', parts: [{ functionCall: model.call }] } }],
            }
          : { functionCalls: [], candidates: [] },
      }),
      generateJson: async () => {
        throw new Error('No notes are sent in these tests');
      },
    },
  };
});

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
let maxId: string;
// Far ahead, and clear of the other roster tests' weeks.
const target = addDaysToDate(mondayOf(zonedToday('Australia/Sydney')), 140);

const build = (ctx: TenantContext, input: Record<string, unknown>) =>
  buildRosterWithAgent(
    ctx,
    rosterAgentBuildSchema.parse({ startsOn: target, span: 'week', start: 'figure_out', ...input }),
  );

const shiftsOf = (input: Awaited<ReturnType<typeof build>>['artifact']) =>
  input.shifts.map((shift) => ({
    date: shift.date,
    startTime: shift.startTime,
    endTime: shift.endTime,
    userId: shift.userId,
    teamId: shift.teamId,
    breaks: shift.breaks,
    note: shift.note,
  }));

beforeAll(async () => {
  const a = await createWorkspace('Alpha Diner', mail('agent-alpha'));
  alphaTenant = a.tenantId;
  samId = await addMember(alphaTenant, mail('agent-sam'), 'Sam Staff', 'member');
  maxId = await addMember(alphaTenant, mail('agent-max'), 'Max Manager', 'manager');
  alphaUsers.push(a.ownerId, samId, maxId);
  owner = await contextFor(a.ownerId, alphaTenant);
  staff = await contextFor(samId, alphaTenant);

  const b = await createWorkspace('Beta Bistro', mail('agent-beta'));
  betaTenant = b.tenantId;
  betaUsers.push(b.ownerId);
  betaOwner = await contextFor(b.ownerId, betaTenant);

  // Four earlier weeks with the same Monday and Wednesday shifts: the pattern to learn.
  for (let week = 1; week <= 4; week += 1) {
    const startsOn = addDaysToDate(target, -7 * week);
    const roster = await createRoster(owner, { startsOn, span: 'week', copyPrevious: false });
    for (const [offset, userId] of [
      [0, samId],
      [2, maxId],
    ] as const) {
      await saveShift(owner, {
        rosterId: roster.id,
        userId,
        teamId: null,
        date: addDaysToDate(startsOn, offset),
        startTime: '09:00',
        endTime: '15:00',
        breaks: [],
        autoBreaks: false,
        note: null,
      });
    }
  }
}, 180_000);

afterAll(async () => {
  if (alphaTenant) await destroyWorkspace(alphaTenant, alphaUsers);
  if (betaTenant) await destroyWorkspace(betaTenant, betaUsers);
}, 60_000);

beforeEach(() => {
  model.call = null;
});

describe('building with the agent', () => {
  it('learns the last four weeks and offers each shift to its regular', async () => {
    const { artifact, reply } = await build(owner, {});
    expect(reply).toContain('last four weeks');
    expect(artifact.source).toBe('patterns');
    expect(artifact.shifts.map((shift) => [shift.date, shift.userId])).toEqual([
      [target, samId],
      [addDaysToDate(target, 2), maxId],
    ]);
  });

  it('copies a roster the manager picks', async () => {
    const [chosen] = await rows<{ id: string }>(sql`
      select id from rosters where tenant_id = ${alphaTenant} and starts_on = ${addDaysToDate(target, -14)}`);
    const { artifact } = await build(owner, { start: 'saved', copyRosterId: chosen!.id });
    expect(artifact.source).toBe('copy');
    expect(artifact.shifts).toHaveLength(2);
  });

  it('another business’s roster cannot be copied', async () => {
    const [foreign] = await rows<{ id: string }>(sql`
      select id from rosters where tenant_id = ${alphaTenant} limit 1`);
    await expectCode(
      () => build(betaOwner, { start: 'saved', copyRosterId: foreign!.id }),
      'NOT_FOUND',
    );
  });

  it('staff without rosters.manage cannot build', async () => {
    await expectCode(() => build(staff, {}), 'FORBIDDEN');
  });

  it('replacing removes the shifts already there before adding the plan', async () => {
    const roster = await createRoster(owner, {
      startsOn: target,
      span: 'week',
      copyPrevious: false,
    });
    const extra = await saveShift(owner, {
      rosterId: roster.id,
      userId: null,
      teamId: null,
      date: addDaysToDate(target, 4),
      startTime: '12:00',
      endTime: '16:00',
      breaks: [],
      autoBreaks: false,
      note: null,
    });
    const { artifact } = await build(owner, { replaceExisting: true });
    expect(artifact.replaces).toEqual([extra.id]);
    const saved = await approveRosterPreview(owner, {
      shifts: shiftsOf(artifact),
      replaceShiftIds: artifact.replaces ?? [],
    });
    expect(saved).toMatchObject({ saved: 2, removed: 1 });
    const live = await listRosterShifts(owner, roster.id);
    expect(live.map((shift) => shift.id)).not.toContain(extra.id);
    expect(live).toHaveLength(2);
  });
});

describe('Instant build, the check and filling vacant shifts', () => {
  it('fills vacant shifts with someone free', async () => {
    const roster = await rows<{ id: string }>(sql`
      select id from rosters where tenant_id = ${alphaTenant} and starts_on = ${target}`);
    const rosterId = roster[0]!.id;
    await saveShift(owner, {
      rosterId,
      userId: null,
      teamId: null,
      date: addDaysToDate(target, 5),
      startTime: '10:00',
      endTime: '14:00',
      breaks: [],
      autoBreaks: false,
      note: null,
    });
    const before = await checkRoster(owner, rosterId);
    expect(before.vacant).toBe(1);
    expect(before.findings[0]).toContain('still vacant');

    const plan = await planVacantFill(owner, rosterId);
    expect(plan.assignments).toHaveLength(1);
    const result = await instantBuild(owner, rosterId);
    expect(result.filled).toBe(1);
    expect(result.check.vacant).toBe(0);
  });

  it('builds an empty roster from the pattern', async () => {
    const startsOn = addDaysToDate(target, 7);
    const roster = await createRoster(owner, { startsOn, span: 'week', copyPrevious: false });
    const result = await instantBuild(owner, roster.id);
    expect(result.added).toBeGreaterThan(0);
    expect((await listRosterShifts(owner, roster.id)).length).toBe(result.added);
  });

  it('another business cannot build, check or fill this roster, and staff cannot either', async () => {
    const [roster] = await rows<{ id: string }>(sql`
      select id from rosters where tenant_id = ${alphaTenant} and starts_on = ${target}`);
    await expectCode(() => instantBuild(betaOwner, roster!.id), 'NOT_FOUND');
    await expectCode(() => checkRoster(betaOwner, roster!.id), 'NOT_FOUND');
    await expectCode(() => planVacantFill(betaOwner, roster!.id), 'NOT_FOUND');
    await expectCode(() => instantBuild(staff, roster!.id), 'FORBIDDEN');
  });
});

describe('removing and reassigning shifts', () => {
  it('another business cannot remove or reassign them', async () => {
    const [shift] = await rows<{ id: string; roster_id: string }>(sql`
      select id, roster_id from roster_shifts where tenant_id = ${alphaTenant} and deleted_at is null limit 1`);
    await expectCode(
      () =>
        removeShifts(
          betaOwner,
          removeShiftsSchema.parse({ rosterId: shift!.roster_id, shiftIds: [shift!.id] }),
        ),
      'NOT_FOUND',
    );
    await expectCode(
      () => reassignShift(betaOwner, { shiftId: shift!.id, userId: null }),
      'NOT_FOUND',
    );
  });

  it('staff without rosters.manage cannot remove or reassign', async () => {
    const [shift] = await rows<{ id: string; roster_id: string }>(sql`
      select id, roster_id from roster_shifts where tenant_id = ${alphaTenant} and deleted_at is null limit 1`);
    await expectCode(
      () =>
        removeShifts(
          staff,
          removeShiftsSchema.parse({ rosterId: shift!.roster_id, shiftIds: [shift!.id] }),
        ),
      'FORBIDDEN',
    );
    await expectCode(() => reassignShift(staff, { shiftId: shift!.id, userId: null }), 'FORBIDDEN');
  });

  it('refuses a list with a shift from another roster, changing nothing', async () => {
    const shifts = await rows<{ id: string; roster_id: string }>(sql`
      select id, roster_id from roster_shifts where tenant_id = ${alphaTenant} and deleted_at is null
      order by starts_at limit 50`);
    const first = shifts[0]!;
    const other = shifts.find((shift) => shift.roster_id !== first.roster_id)!;
    await expectCode(
      () =>
        removeShifts(
          owner,
          removeShiftsSchema.parse({ rosterId: first.roster_id, shiftIds: [first.id, other.id] }),
        ),
      'CONFLICT',
    );
    const [still] = await rows<{ n: number }>(sql`
      select count(*)::int as n from roster_shifts where id = ${first.id} and deleted_at is null`);
    expect(still?.n).toBe(1);
  });

  it('reassigning keeps the shift’s times, and leaving it vacant works', async () => {
    const [roster] = await rows<{ id: string }>(sql`
      select id from rosters where tenant_id = ${alphaTenant} and starts_on = ${target}`);
    const [shift] = (await listRosterShifts(owner, roster!.id)).filter((item) => item.userId);
    await reassignShift(owner, { shiftId: shift!.id, userId: null });
    const after = (await listRosterShifts(owner, roster!.id)).find(
      (item) => item.date === shift!.date && item.startTime === shift!.startTime && !item.userId,
    );
    expect(after?.endTime).toBe(shift!.endTime);
  });
});

describe('chatting with the agent', () => {
  it('a proposal to remove the vacant shifts removes nothing by itself', async () => {
    const [roster] = await rows<{ id: string }>(sql`
      select id from rosters where tenant_id = ${alphaTenant} and starts_on = ${target}`);
    const before = await listRosterShifts(owner, roster!.id);
    model.call = { name: 'propose_remove_shifts', args: { which: 'vacant' } };
    const result = await chatAboutRoster(
      owner,
      rosterChatSchema.parse({ rosterId: roster!.id, prompt: 'remove the vacant shifts' }),
    );
    expect(result.artifact?.kind).toBe('remove_shifts');
    const vacantIds = before.filter((shift) => !shift.userId).map((shift) => shift.id);
    expect(result.artifact && 'shiftIds' in result.artifact && result.artifact.shiftIds).toEqual(
      vacantIds,
    );
    expect(await listRosterShifts(owner, roster!.id)).toHaveLength(before.length);
  });

  it('another business cannot chat about this roster, and staff cannot chat at all', async () => {
    const [roster] = await rows<{ id: string }>(sql`
      select id from rosters where tenant_id = ${alphaTenant} and starts_on = ${target}`);
    const input = rosterChatSchema.parse({ rosterId: roster!.id, prompt: 'who is on Monday?' });
    await expectCode(() => chatAboutRoster(betaOwner, input), 'NOT_FOUND');
    await expectCode(() => chatAboutRoster(staff, input), 'FORBIDDEN');
  });
});
