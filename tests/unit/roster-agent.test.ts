import { describe, expect, it } from 'vitest';

import { coverageGaps, demandByDate } from '@/modules/ai/roster-coverage';
import {
  requirementsCopyingPeriod,
  requirementsFromRecentWeeks,
  solveRoster,
  type SolverInput,
} from '@/modules/ai/roster-solver';

// The roster agent (ADR-079): patterns from recent weeks, copying a chosen roster, contracted
// hours first, why a shift is vacant, and cover against the trading hours' staff numbers.

// 2026-12-14 is a Monday.
const shift = (
  date: string,
  userId: string | null,
  startTime = '09:00',
  endTime = '17:00',
  teamId: string | null = null,
) => ({ date, startTime, endTime, teamId, userId });

const base = (overrides: Partial<SolverInput> = {}): SolverInput => ({
  dates: ['2026-12-14'],
  requirements: [],
  people: [
    { userId: 'ana', name: 'Ana', teamIds: [] },
    { userId: 'ben', name: 'Ben', teamIds: [] },
  ],
  leave: [],
  existing: [],
  breakRules: [],
  ...overrides,
});

describe('the pattern of recent weeks', () => {
  it('keeps a shift with as many people as a typical week had, offered to its regulars', () => {
    const weeks = [
      [shift('2026-12-07', 'ana'), shift('2026-12-07', 'ben')],
      [shift('2026-11-30', 'ana'), shift('2026-11-30', 'ben')],
      [shift('2026-11-23', 'ana')],
      [shift('2026-11-16', 'ana'), shift('2026-11-16', 'cal'), shift('2026-11-16', 'ben')],
    ];
    expect(requirementsFromRecentWeeks(weeks)).toEqual([
      {
        weekdays: ['mon'],
        startTime: '09:00',
        endTime: '17:00',
        staffNeeded: 2,
        teamId: null,
        note: null,
        preferred: ['ana', 'ben'],
      },
    ]);
  });

  it('drops a one-off shift and ignores weeks that were never rostered', () => {
    const weeks = [
      [shift('2026-12-12', 'ana', '10:00', '16:00')],
      [shift('2026-12-05', 'ana', '10:00', '16:00'), shift('2026-12-05', 'ben', '18:00', '22:00')],
      [],
      [shift('2026-11-21', 'ana', '10:00', '16:00')],
    ];
    const requirements = requirementsFromRecentWeeks(weeks);
    expect(requirements.map((item) => [item.weekdays, item.startTime, item.staffNeeded])).toEqual([
      [['sat'], '10:00', 1],
    ]);
  });

  it('returns nothing when no week was rostered', () => {
    expect(requirementsFromRecentWeeks([[], [], [], []])).toEqual([]);
  });
});

describe('copying a chosen roster', () => {
  const targetWeek = Array.from({ length: 7 }, (_, index) => `2026-12-${14 + index}`);

  it('puts each shift on the same day of the new period, offered to whoever had it', () => {
    const requirements = requirementsCopyingPeriod(
      [shift('2026-11-18', 'ana'), shift('2026-11-22', null, '12:00', '20:00')],
      { startsOn: '2026-11-16', days: 7 },
      targetWeek,
    );
    expect(requirements.map((item) => [item.dates, item.preferred, item.staffNeeded])).toEqual([
      [['2026-12-16'], ['ana'], 1],
      [['2026-12-20'], [null], 1],
    ]);
  });

  it('repeats a week to fill a fortnight', () => {
    const fortnight = Array.from({ length: 14 }, (_, index) =>
      new Date(Date.UTC(2026, 11, 14 + index)).toISOString().slice(0, 10),
    );
    const requirements = requirementsCopyingPeriod(
      [shift('2026-11-16', 'ana')],
      { startsOn: '2026-11-16', days: 7 },
      fortnight,
    );
    expect(requirements.flatMap((item) => item.dates)).toEqual(['2026-12-14', '2026-12-21']);
  });
});

describe('the solver for the agent', () => {
  it('fills only the dates a requirement names, and carries its ref', () => {
    const result = solveRoster(
      base({
        dates: ['2026-12-14', '2026-12-21'],
        requirements: [
          {
            weekdays: ['mon'],
            dates: ['2026-12-21'],
            startTime: '09:00',
            endTime: '13:00',
            staffNeeded: 1,
            teamId: null,
            note: null,
            ref: 'shift-1',
          },
        ],
      }),
    );
    expect(result.shifts).toHaveLength(1);
    expect(result.shifts[0]).toMatchObject({ date: '2026-12-21', ref: 'shift-1' });
  });

  it('offers shifts to people still short of their contracted hours first', () => {
    const requirement = {
      weekdays: ['mon' as const],
      startTime: '09:00',
      endTime: '13:00',
      staffNeeded: 1,
      teamId: null,
      note: null,
    };
    // Ben has more hours already, but is the one owed contracted hours.
    const result = solveRoster(
      base({
        requirements: [requirement],
        existing: [shift('2026-12-15', 'ben', '09:00', '13:00')],
        dates: ['2026-12-14', '2026-12-15'],
        targets: { ben: 20 * 60 },
      }),
    );
    expect(result.shifts.find((item) => item.date === '2026-12-14')?.userId).toBe('ben');
  });

  it('says a shift is vacant because nobody is in its team', () => {
    const result = solveRoster(
      base({
        requirements: [
          {
            weekdays: ['mon'],
            startTime: '09:00',
            endTime: '17:00',
            staffNeeded: 1,
            teamId: 'cross-trained',
            note: null,
          },
        ],
      }),
    );
    expect(result.shifts[0]).toMatchObject({ userId: null, vacantReason: 'no_one_in_team' });
    expect(result.warnings[0]).toContain('nobody who can be rostered is in its team');
  });

  it('says a shift is vacant because everyone free has reached the hours cap', () => {
    const result = solveRoster(
      base({
        people: [{ userId: 'ana', name: 'Ana', teamIds: [] }],
        requirements: [
          {
            weekdays: ['mon'],
            startTime: '09:00',
            endTime: '17:00',
            staffNeeded: 1,
            teamId: null,
            note: null,
          },
        ],
        maxMinutesPerPerson: 60,
      }),
    );
    expect(result.shifts[0]).toMatchObject({ userId: null, vacantReason: 'hours_cap' });
  });
});

describe('cover against the staff numbers', () => {
  const monday = { weekday: 1, opensAt: '09:00', closesAt: '17:00', staffNeeded: 2 };

  it('works out the person-hours each day needs', () => {
    expect(demandByDate([monday], ['2026-12-14', '2026-12-15'])).toEqual({
      '2026-12-14': 960,
      '2026-12-15': 0,
    });
  });

  it('finds where fewer people are on than needed, and ignores vacant shifts', () => {
    const gaps = coverageGaps(
      [monday],
      ['2026-12-14'],
      [
        shift('2026-12-14', 'ana', '09:00', '17:00'),
        shift('2026-12-14', 'ben', '09:00', '13:00'),
        shift('2026-12-14', null, '13:00', '17:00'),
      ],
    );
    expect(gaps).toEqual([{ date: '2026-12-14', from: '13:00', to: '17:00', short: 1 }]);
  });

  it('counts a shift from the night before that runs into the morning', () => {
    const gaps = coverageGaps(
      [{ weekday: 2, opensAt: '00:00', closesAt: '02:00', staffNeeded: 1 }],
      ['2026-12-14', '2026-12-15'],
      [shift('2026-12-14', 'ana', '22:00', '03:00')],
    );
    expect(gaps).toEqual([]);
  });
});
