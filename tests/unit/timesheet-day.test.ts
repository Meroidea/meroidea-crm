import { describe, expect, it } from 'vitest';

import { matchDay, type DayEntry, type DayShift } from '@/modules/timesheets/day';

const shift = (id: string, userId: string, startTime: string): DayShift => ({
  id,
  userId,
  teamId: null,
  date: '2026-10-14',
  startTime,
  endTime: '17:00',
  breakMinutes: 30,
  paidMinutes: 450,
});
const entry = (
  id: string,
  userId: string,
  startTime: string,
  shiftId: string | null = null,
): DayEntry => ({
  id,
  userId,
  shiftId,
  date: '2026-10-14',
  startTime,
  endTime: '17:05',
  breakMinutes: 30,
  workedMinutes: 450,
  status: 'pending',
  source: 'clock',
});
const pairs = (rows: ReturnType<typeof matchDay>) =>
  rows.map((row) => [row.shift?.id ?? null, row.entry?.id ?? null]);

describe('pairing rostered shifts with recorded time for a day', () => {
  it('puts a person’s clocked time with their shift', () => {
    expect(pairs(matchDay([shift('s1', 'a', '09:00')], [entry('e1', 'a', '08:57')]))).toEqual([
      ['s1', 'e1'],
    ]);
  });

  it('keeps time recorded against a shift with that shift, whatever the clock says', () => {
    const rows = matchDay(
      [shift('s1', 'a', '09:00'), shift('s2', 'a', '17:00')],
      [entry('e1', 'a', '09:02', 's2')],
    );
    expect(pairs(rows)).toEqual([
      ['s1', null],
      ['s2', 'e1'],
    ]);
  });

  it('gives each of two shifts in a day the time nearest its start', () => {
    const rows = matchDay(
      [shift('s1', 'a', '09:00'), shift('s2', 'a', '17:00')],
      [entry('e2', 'a', '17:10'), entry('e1', 'a', '08:50')],
    );
    expect(pairs(rows)).toEqual([
      ['s1', 'e1'],
      ['s2', 'e2'],
    ]);
  });

  it('never gives one person’s time to another person’s shift', () => {
    expect(pairs(matchDay([shift('s1', 'a', '09:00')], [entry('e1', 'b', '09:00')]))).toEqual([
      ['s1', null],
      [null, 'e1'],
    ]);
  });

  it('lists time with no shift, and a shift with no time, as rows of their own', () => {
    const rows = matchDay(
      [shift('s1', 'a', '09:00')],
      [entry('e1', 'a', '09:00'), entry('e2', 'a', '19:00')],
    );
    expect(pairs(rows)).toEqual([
      ['s1', 'e1'],
      [null, 'e2'],
    ]);
  });
});
