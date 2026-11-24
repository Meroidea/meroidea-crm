import { describe, expect, it } from 'vitest';

import {
  productivityScore,
  requirementsCopyingWeek,
  requirementsFromTradingHours,
  solveRoster,
  type SolverInput,
} from '@/modules/ai/roster-solver';
import { tradingWeekSchema } from '@/modules/trading-hours/schemas';

// MeroAI's roster strategies (ADR-076): shifts from trading hours, and who is preferred.

const day = (
  weekday: number,
  opensAt: string | null,
  closesAt: string | null,
  staffNeeded = 1,
) => ({
  weekday,
  opensAt,
  closesAt,
  staffNeeded,
});

describe('shifts from trading hours', () => {
  it('covers a normal day with one shift and skips closed days', () => {
    expect(requirementsFromTradingHours([day(1, '09:00', '17:00', 2), day(0, null, null)])).toEqual(
      [
        {
          weekdays: ['mon'],
          startTime: '09:00',
          endTime: '17:00',
          staffNeeded: 2,
          teamId: null,
          note: null,
        },
      ],
    );
  });

  it('splits a long day into back-to-back shifts of at most eight hours, on quarter hours', () => {
    const requirements = requirementsFromTradingHours([day(5, '07:00', '22:00', 3)]);
    expect(requirements.map((item) => [item.startTime, item.endTime, item.staffNeeded])).toEqual([
      ['07:00', '14:30', 3],
      ['14:30', '22:00', 3],
    ]);
  });

  it('handles trading past midnight', () => {
    const requirements = requirementsFromTradingHours([day(6, '18:00', '02:00')]);
    expect(requirements.map((item) => [item.startTime, item.endTime])).toEqual([
      ['18:00', '02:00'],
    ]);
  });

  it('groups days with the same hours into one requirement', () => {
    const week = [1, 2, 3, 4, 5].map((weekday) => day(weekday, '09:00', '17:00'));
    expect(requirementsFromTradingHours(week)).toHaveLength(1);
    expect(requirementsFromTradingHours(week)[0]?.weekdays).toEqual([
      'mon',
      'tue',
      'wed',
      'thu',
      'fri',
    ]);
  });
});

describe('strategies choose people', () => {
  // 2026-11-30 is a Monday.
  const base: SolverInput = {
    dates: ['2026-11-30', '2026-12-01'],
    requirements: [
      {
        weekdays: ['mon', 'tue'],
        startTime: '09:00',
        endTime: '17:00',
        staffNeeded: 1,
        teamId: null,
        note: null,
      },
    ],
    people: [
      { userId: 'ana', name: 'Ana', teamIds: [] },
      { userId: 'ben', name: 'Ben', teamIds: [] },
    ],
    leave: [],
    existing: [],
    breakRules: [],
  };

  it('copying last week gives each shift back to the person who had it', () => {
    const requirements = requirementsCopyingWeek([
      { date: '2026-11-23', startTime: '09:00', endTime: '17:00', teamId: null, userId: 'ben' },
      { date: '2026-11-24', startTime: '09:00', endTime: '17:00', teamId: null, userId: 'ben' },
    ]);
    const result = solveRoster({ ...base, requirements });
    expect(result.shifts.map((shift) => shift.userId)).toEqual(['ben', 'ben']);
  });

  it('copying last week swaps someone now on leave for whoever is free', () => {
    const requirements = requirementsCopyingWeek([
      { date: '2026-11-23', startTime: '09:00', endTime: '17:00', teamId: null, userId: 'ben' },
    ]);
    const result = solveRoster({
      ...base,
      requirements,
      leave: [{ userId: 'ben', startsOn: '2026-11-30', endsOn: '2026-11-30' }],
    });
    expect(result.shifts.map((shift) => shift.userId)).toEqual(['ana']);
  });

  it('the cheapest person gets the shift when ranked by wage cost', () => {
    const hourly: Record<string, number> = { ana: 32, ben: 26 };
    const result = solveRoster({
      ...base,
      rank: (userId, _date, minutes) => hourly[userId]! * minutes,
    });
    expect(result.shifts.map((shift) => shift.userId)).toEqual(['ben', 'ben']);
  });

  it('nobody goes past the ordinary hours cap, whatever the ranking prefers', () => {
    const result = solveRoster({
      ...base,
      rank: (userId) => (userId === 'ben' ? 0 : 1),
      maxMinutesPerPerson: 8 * 60,
    });
    expect(result.shifts.map((shift) => shift.userId)).toEqual(['ben', 'ana']);
  });

  it('explains a vacancy left by the hours cap, so the manager knows to hire', () => {
    const result = solveRoster({
      ...base,
      people: [{ userId: 'ana', name: 'Ana', teamIds: [] }],
      maxMinutesPerPerson: 8 * 60,
    });
    expect(result.shifts.map((shift) => shift.userId)).toEqual(['ana', null]);
    expect(result.warnings[0]).toContain('everyone free has reached 8 hours');
  });

  it('scores a record from attendance and on-time tasks, and knows when it knows nothing', () => {
    expect(
      productivityScore({
        rosteredMinutes: 600,
        clockedMinutes: 540,
        tasksOnTime: 4,
        tasksWithDueDate: 4,
      }),
    ).toBeCloseTo(0.95);
    expect(
      productivityScore({
        rosteredMinutes: 600,
        clockedMinutes: 900,
        tasksOnTime: null,
        tasksWithDueDate: null,
      }),
    ).toBe(1);
    expect(
      productivityScore({
        rosteredMinutes: 0,
        clockedMinutes: 0,
        tasksOnTime: 0,
        tasksWithDueDate: 0,
      }),
    ).toBeNull();
  });
});

describe('trading hours form', () => {
  const week = (patch: Record<number, object> = {}) =>
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      open: weekday !== 0,
      opensAt: weekday !== 0 ? '09:00' : '',
      closesAt: weekday !== 0 ? '17:00' : '',
      staffNeeded: 2,
      ...patch[weekday],
    }));

  it('accepts a week, storing closed days without times', () => {
    const parsed = tradingWeekSchema.parse(week());
    expect(parsed[0]).toEqual({ weekday: 0, opensAt: null, closesAt: null, staffNeeded: 2 });
    expect(parsed[1]).toEqual({ weekday: 1, opensAt: '09:00', closesAt: '17:00', staffNeeded: 2 });
  });

  it('refuses an open day without hours, the same open and close, or nobody on', () => {
    expect(tradingWeekSchema.safeParse(week({ 1: { closesAt: '' } })).success).toBe(false);
    expect(tradingWeekSchema.safeParse(week({ 2: { closesAt: '09:00' } })).success).toBe(false);
    expect(tradingWeekSchema.safeParse(week({ 3: { staffNeeded: 0 } })).success).toBe(false);
    expect(tradingWeekSchema.safeParse(week().slice(0, 6)).success).toBe(false);
  });
});
