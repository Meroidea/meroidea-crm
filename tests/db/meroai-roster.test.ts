import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { addDaysToDate, mondayOf, zonedToday } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { FEATURE_KEYS } from '@/lib/features';
import { buildRosterWithMeroAI } from '@/modules/ai/meroai-roster';
import { rosterStrategyOptions } from '@/modules/ai/roster-planner';
import { meroAIRosterSchema } from '@/modules/ai/schemas';
import { approveRosterPreview } from '@/modules/ai/service';
import type { RosterPreviewArtifact } from '@/modules/ai/types';
import { getTradingHours } from '@/modules/trading-hours/queries';
import { saveTradingHoursSchema } from '@/modules/trading-hours/schemas';
import { saveTradingHours } from '@/modules/trading-hours/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

// Trading hours and Ask MeroAI on the roster page (ADR-076), against the real database and RLS.
// Strategies need no model; only reading typed notes does, and only that is replaced here.

const model = vi.hoisted(() => ({ notes: null as unknown, calls: 0 }));

vi.mock('@/server/ai', () => {
  const modelFor = (tier: string) => (tier === 'reasoning' ? 'test-reasoning' : 'test-fast');
  return {
    isAiConfigured: () => true,
    modelFor,
    aiService: {
      isConfigured: () => true,
      modelFor,
      responseText: () => '',
      generate: async () => {
        throw new Error('Strategies must not call the model');
      },
      generateJson: async () => {
        model.calls += 1;
        return model.notes;
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

/** Monday to Friday 09:00–17:00 with two on, Saturday 10:00–14:00 with one, Sunday closed. */
const tradingWeek = saveTradingHoursSchema.parse({
  days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    open: weekday !== 0,
    opensAt: weekday === 6 ? '10:00' : weekday === 0 ? '' : '09:00',
    closesAt: weekday === 6 ? '14:00' : weekday === 0 ? '' : '17:00',
    staffNeeded: weekday === 6 ? 1 : 2,
  })),
});

let alphaTenant: string;
let betaTenant: string;
const alphaUsers: string[] = [];
const betaUsers: string[] = [];
let owner: TenantContext;
let staff: TenantContext;
let max: TenantContext;
let betaOwner: TenantContext;
// Far enough ahead that no other test's rosters are near it.
const monday = addDaysToDate(mondayOf(zonedToday('Australia/Sydney')), 63);

const ask = (ctx: TenantContext, input: Record<string, unknown>) =>
  buildRosterWithMeroAI(ctx, meroAIRosterSchema.parse({ span: 'week', ...input }));

beforeAll(async () => {
  const a = await createWorkspace('Alpha Deli', mail('meroai-alpha'));
  alphaTenant = a.tenantId;
  const staffId = await addMember(alphaTenant, mail('meroai-sam'), 'Sam Staff', 'member');
  const maxId = await addMember(alphaTenant, mail('meroai-max'), 'Max Manager', 'manager');
  alphaUsers.push(a.ownerId, staffId, maxId);
  owner = await contextFor(a.ownerId, alphaTenant);
  staff = await contextFor(staffId, alphaTenant);
  max = await contextFor(maxId, alphaTenant);

  const b = await createWorkspace('Beta Bakery', mail('meroai-beta'));
  betaTenant = b.tenantId;
  betaUsers.push(b.ownerId);
  betaOwner = await contextFor(b.ownerId, betaTenant);
}, 120_000);

afterAll(async () => {
  if (alphaTenant) await destroyWorkspace(alphaTenant, alphaUsers);
  if (betaTenant) await destroyWorkspace(betaTenant, betaUsers);
}, 60_000);

beforeEach(() => {
  model.notes = null;
  model.calls = 0;
});

describe('trading hours', () => {
  it('the admin sets them, and the change is audited', async () => {
    expect(await saveTradingHours(owner, tradingWeek)).toEqual({ openDays: 6 });
    const days = await getTradingHours(owner);
    expect(days.find((day) => day.weekday === 1)).toEqual({
      weekday: 1,
      opensAt: '09:00',
      closesAt: '17:00',
      staffNeeded: 2,
    });
    expect(days.find((day) => day.weekday === 0)?.opensAt).toBeNull();
    const [entry] = await rows<{ context: { openDays: number } }>(sql`
      select context from audit_logs where tenant_id = ${alphaTenant} and entity_type = 'trading_hours'
      order by id desc limit 1`);
    expect(entry?.context.openDays).toBe(6);
  });

  it('staff can read them but not change them, in the service or the database', async () => {
    expect((await getTradingHours(staff)).length).toBe(7);
    await expectCode(() => saveTradingHours(staff, tradingWeek), 'FORBIDDEN');
    const state = await withRls(staff, (tx) =>
      tx
        .execute(sql`update trading_hours set staff_needed = 9 where tenant_id = ${alphaTenant}`)
        .then(() => 'updated')
        .catch(() => 'refused'),
    );
    const [check] = await rows<{ n: number }>(
      sql`select count(*)::int as n from trading_hours where tenant_id = ${alphaTenant} and staff_needed = 9`,
    );
    expect(state === 'refused' || check?.n === 0).toBe(true);
  });

  it('another business never sees them', async () => {
    expect(await getTradingHours(betaOwner)).toEqual([]);
    const leaked = await withRls(betaOwner, (tx) =>
      tx.execute(
        sql`select count(*)::int as n from trading_hours where tenant_id = ${alphaTenant}`,
      ),
    );
    expect((leaked as unknown as { n: number }[])[0]?.n).toBe(0);
  });
});

describe('Ask MeroAI on the roster page', () => {
  it('covers the trading hours with the right number of people, without asking or calling a model', async () => {
    const { artifact } = await ask(owner, { startsOn: monday, strategy: 'even_hours' });
    expect(artifact.source).toBe('trading_hours');
    // Two on each weekday, one on Saturday, nobody on Sunday: 11 shifts.
    expect(artifact.shifts).toHaveLength(11);
    expect(
      artifact.shifts
        .filter((shift) => shift.date === monday)
        .map((shift) => [shift.startTime, shift.endTime]),
    ).toEqual([
      ['09:00', '17:00'],
      ['09:00', '17:00'],
    ]);
    expect(artifact.shifts.find((shift) => shift.date === addDaysToDate(monday, 5))).toMatchObject({
      startTime: '10:00',
      endTime: '14:00',
    });
    expect(artifact.shifts.some((shift) => shift.date === addDaysToDate(monday, 6))).toBe(false);
    expect(model.calls).toBe(0);

    const [entry] = await rows<{ context: Record<string, unknown> }>(sql`
      select context from audit_logs where tenant_id = ${alphaTenant} and action = 'ai_assist'
      order by id desc limit 1`);
    expect(entry?.context).toMatchObject({
      surface: 'roster',
      strategy: 'even_hours',
      instructionsRead: false,
      model: null,
    });
  });

  it('saves nothing until the manager approves', async () => {
    const [before] = await rows<{ n: number }>(
      sql`select count(*)::int as n from rosters where tenant_id = ${alphaTenant}`,
    );
    await ask(owner, { startsOn: monday, strategy: 'even_hours' });
    const [after] = await rows<{ n: number }>(
      sql`select count(*)::int as n from rosters where tenant_id = ${alphaTenant}`,
    );
    expect(after?.n).toBe(before?.n);
  });

  it('copies last week with the same people', async () => {
    const first = (await ask(owner, { startsOn: monday, strategy: 'even_hours' })).artifact;
    const saved = await approveRosterPreview(owner, {
      shifts: first.shifts.map(({ date, startTime, endTime, userId, teamId, breaks, note }) => ({
        date,
        startTime,
        endTime,
        userId,
        teamId,
        breaks,
        note,
      })),
    });
    expect(saved.saved).toBe(11);

    const next = addDaysToDate(monday, 7);
    const options = await rosterStrategyOptions(owner, next);
    expect(options.options.find((option) => option.key === 'copy_last_week')?.available).toBe(true);
    const { artifact } = await ask(owner, { startsOn: next, strategy: 'copy_last_week' });
    const who = (preview: RosterPreviewArtifact, offset: number) =>
      preview.shifts
        .filter((shift) => shift.date === addDaysToDate(preview.startsOn, offset))
        .map((shift) => shift.userId)
        .sort();
    for (const offset of [0, 1, 2, 3, 4, 5])
      expect(who(artifact, offset)).toEqual(who(first, offset));
  });

  it('reads typed notes: someone who cannot work a day is kept off it, and an unknown name is reported', async () => {
    const friday = addDaysToDate(monday, 4);
    model.notes = {
      unavailable: [
        { person: 'Sam', dates: [friday] },
        { person: 'Nobody Here', dates: [friday] },
      ],
      onlyPeople: [],
    };
    const { artifact } = await ask(owner, {
      startsOn: monday,
      strategy: 'even_hours',
      instructions: 'Sam can’t work Friday',
    });
    expect(model.calls).toBe(1);
    expect(
      artifact.shifts.filter((shift) => shift.date === friday).map((shift) => shift.userId),
    ).not.toContain(staff.userId);
    expect(artifact.warnings.join(' ')).toContain('“Nobody Here”');
  });

  it('says why a strategy cannot run instead of doing something else', async () => {
    const options = await rosterStrategyOptions(owner, monday);
    // Nobody here has an hourly contract, so there is nothing to price.
    expect(options.options.find((option) => option.key === 'lowest_cost')).toMatchObject({
      available: false,
      reason: expect.stringContaining('hourly rate'),
    });
    await expectCode(() => ask(owner, { startsOn: monday, strategy: 'lowest_cost' }), 'CONFLICT');
  });

  it('is for people who manage rosters, and only while the business has MeroAI', async () => {
    await expectCode(() => ask(staff, { startsOn: monday, strategy: 'even_hours' }), 'FORBIDDEN');
    // Managers see everyone's roster but only the Admin builds it by default (docs/permissions.md).
    await expectCode(() => ask(max, { startsOn: monday, strategy: 'even_hours' }), 'FORBIDDEN');

    await adminDb().execute(sql`
      update tenants set features = ${sql.raw(
        `array[${FEATURE_KEYS.filter((key) => key !== 'ai_assistant')
          .map((key) => `'${key}'`)
          .join(',')}]::text[]`,
      )} where id = ${alphaTenant}`);
    try {
      const off = await contextFor(owner.userId, alphaTenant);
      await expectCode(() => ask(off, { startsOn: monday, strategy: 'even_hours' }), 'FORBIDDEN');
    } finally {
      await adminDb().execute(sql`
        update tenants set features = ${sql.raw(`array[${FEATURE_KEYS.map((key) => `'${key}'`).join(',')}]::text[]`)}
        where id = ${alphaTenant}`);
    }
  });

  it('a business without trading hours or a week before is told what to set, and only rosters its own people', async () => {
    await expectCode(
      () => ask(betaOwner, { startsOn: monday, strategy: 'even_hours' }),
      'CONFLICT',
    );
    const options = await rosterStrategyOptions(betaOwner, monday);
    expect(options.tradingHoursSet).toBe(false);
    expect(options.options.find((option) => option.key === 'even_hours')?.reason).toContain(
      'trading hours',
    );

    await saveTradingHours(betaOwner, tradingWeek);
    const { artifact } = await ask(betaOwner, { startsOn: monday, strategy: 'even_hours' });
    const people = new Set(artifact.shifts.map((shift) => shift.userId).filter(Boolean));
    expect([...people]).toEqual([betaOwner.userId]);
  });
});
