import { describe, expect, it } from 'vitest';

import { breaksFor, planAuthorisation, type AuthoriseSource } from '@/modules/ai/timesheet-planner';
import type { BreakRule } from '@/modules/roster/rules';

// MeroAI's timesheet authorisation (ADR-082), with the owner's break tiers written as the
// business's break rules: longer than 5 hours, 30 min unpaid and 10 min paid; longer than
// 8 hours, another 30 and 10 (60 unpaid and 20 paid in all).
const RULES: BreakRule[] = [
  { fromMinutes: 300, minutes: 30, paid: false },
  { fromMinutes: 300, minutes: 10, paid: true },
  { fromMinutes: 480, minutes: 30, paid: false },
  { fromMinutes: 480, minutes: 10, paid: true },
];

const NOW = '2026-11-23T09:00';

const source = (overrides: Partial<AuthoriseSource> = {}): AuthoriseSource => ({
  key: 'row',
  userId: 'ana',
  fullName: 'Ana Lane',
  team: 'Floor',
  date: '2026-11-18',
  shift: { id: 'shift-1', startTime: '10:00', endTime: '17:30' },
  entry: null,
  canApprove: true,
  ...overrides,
});

describe('breaks by shift length', () => {
  it('gives no break up to 5 hours', () => {
    expect(breaksFor('10:00', '13:00', RULES)).toMatchObject({ unpaid: 0, paid: 0, worked: 180 });
    expect(breaksFor('10:00', '15:00', RULES)).toMatchObject({ unpaid: 0, paid: 0, worked: 300 });
  });

  it('gives 30 unpaid and 10 paid over 5 hours, up to 8', () => {
    expect(breaksFor('10:00', '15:01', RULES)).toMatchObject({ unpaid: 30, paid: 10 });
    expect(breaksFor('10:00', '17:30', RULES)).toMatchObject({ unpaid: 30, paid: 10, worked: 420 });
    expect(breaksFor('09:00', '17:00', RULES)).toMatchObject({ unpaid: 30, paid: 10 });
  });

  it('gives 60 unpaid and 20 paid over 8 hours', () => {
    expect(breaksFor('10:00', '20:30', RULES)).toMatchObject({ unpaid: 60, paid: 20, worked: 570 });
    expect(breaksFor('12:00', '20:30', RULES)).toMatchObject({ unpaid: 60, paid: 20 });
  });

  it('counts a shift past midnight by its real length', () => {
    expect(breaksFor('18:00', '02:00', RULES)).toMatchObject({ length: 480, unpaid: 30 });
  });
});

describe('which times are authorised', () => {
  it('uses the clock-in and clock-out when both were recorded, and says how they differ', () => {
    const [row] = planAuthorisation(
      [
        source({
          entry: {
            id: 'e1',
            startTime: '10:07',
            endTime: '17:45',
            breakMinutes: 0,
            status: 'pending',
            source: 'clock',
          },
        }),
      ],
      RULES,
      NOW,
    );
    expect(row).toMatchObject({
      basis: 'clock',
      start: '10:07',
      end: '17:45',
      unpaidMinutes: 30,
      paidBreakMinutes: 10,
      workedMinutes: 428,
      status: 'ready',
      entryId: 'e1',
      shiftId: 'shift-1',
    });
    expect(row?.notes).toContain('Started 7 min late');
    expect(row?.notes).toContain('Finished 15 min late');
  });

  it('uses the rostered times when nothing was recorded', () => {
    const [row] = planAuthorisation([source()], RULES, NOW);
    expect(row).toMatchObject({
      basis: 'roster',
      start: '10:00',
      end: '17:30',
      workedMinutes: 420,
    });
    expect(row?.notes[0]).toContain('rostered times are used');
  });

  it('finishes someone still clocked in at the rostered end', () => {
    const [row] = planAuthorisation(
      [
        source({
          entry: {
            id: 'e2',
            startTime: '09:55',
            endTime: null,
            breakMinutes: 0,
            status: 'pending',
            source: 'clock',
          },
        }),
      ],
      RULES,
      NOW,
    );
    expect(row).toMatchObject({ basis: 'clock', start: '09:55', end: '17:30' });
    expect(row?.notes[0]).toContain('Still clocked in');
  });

  it('leaves shifts that have not finished yet out', () => {
    expect(planAuthorisation([source({ date: '2026-11-23' })], RULES, NOW)).toEqual([]);
    expect(
      planAuthorisation(
        [source({ date: '2026-11-22', shift: { id: 's', startTime: '22:00', endTime: '10:00' } })],
        RULES,
        NOW,
      ),
    ).toEqual([]);
  });

  it('includes time worked without a shift', () => {
    const [row] = planAuthorisation(
      [
        source({
          shift: null,
          entry: {
            id: 'e3',
            startTime: '12:00',
            endTime: '16:00',
            breakMinutes: 0,
            status: 'pending',
            source: 'manual',
          },
        }),
      ],
      RULES,
      NOW,
    );
    expect(row).toMatchObject({ basis: 'typed', workedMinutes: 240, rostered: null });
    expect(row?.notes).toContain('Not rostered: worked without a shift');
  });

  it('leaves approved time alone and hands rejected or own time to a person', () => {
    const entry = {
      id: 'e4',
      startTime: '10:00',
      endTime: '17:30',
      breakMinutes: 30,
      source: 'clock' as const,
    };
    const rows = planAuthorisation(
      [
        source({ key: 'a', entry: { ...entry, status: 'approved' } }),
        source({ key: 'b', entry: { ...entry, id: 'e5', status: 'rejected' } }),
        source({ key: 'c', canApprove: false }),
      ],
      RULES,
      NOW,
    );
    expect(Object.fromEntries(rows.map((row) => [row.key, row.status]))).toEqual({
      a: 'approved',
      b: 'skip',
      c: 'skip',
    });
  });

  it('notes when the rules change a break the person recorded', () => {
    const [row] = planAuthorisation(
      [
        source({
          entry: {
            id: 'e6',
            startTime: '10:00',
            endTime: '17:30',
            breakMinutes: 45,
            status: 'pending',
            source: 'clock',
          },
        }),
      ],
      RULES,
      NOW,
    );
    expect(row?.unpaidMinutes).toBe(30);
    expect(row?.notes).toContain('Break set by your rules (45 min was recorded)');
  });
});
