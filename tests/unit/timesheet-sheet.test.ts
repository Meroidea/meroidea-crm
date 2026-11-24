import { describe, expect, it } from 'vitest';

import type { DayEntry, DayShift } from '@/modules/timesheets/day';
import { sheetRows } from '@/modules/timesheets/sheet-rows';

// The Timesheet view (ADR-083): what each shift says before and after the period is authorised.

const shift = (id: string, date: string, startTime = '10:00', endTime = '17:30'): DayShift => ({
  id,
  userId: 'ana',
  teamId: null,
  date,
  startTime,
  endTime,
  breakMinutes: 30,
  paidMinutes: 420,
});

const entry = (overrides: Partial<DayEntry> = {}): DayEntry => ({
  id: 'e1',
  userId: 'ana',
  shiftId: 's1',
  date: '2026-11-16',
  startTime: '10:04',
  endTime: '17:31',
  breakMinutes: 30,
  workedMinutes: 417,
  status: 'pending',
  source: 'clock',
  ...overrides,
});

const rows = (shifts: DayShift[], entries: DayEntry[], locked = false) =>
  sheetRows({ shifts, entries, teamOf: () => null, locked, now: '2026-11-18T12:00' });

describe('before the period is authorised', () => {
  it('shows the clock-in and clock-out against the shift', () => {
    const [row] = rows([shift('s1', '2026-11-16')], [entry()]);
    expect(row).toMatchObject({
      status: 'recorded',
      rostered: { start: '10:00', end: '17:30' },
      times: { start: '10:04', end: '17:31' },
    });
  });

  it('says nobody clocked in once a shift has finished with nothing recorded', () => {
    expect(rows([shift('s1', '2026-11-16')], [])[0]?.status).toBe('no_clock');
  });

  it('a shift still to come is upcoming, not missed', () => {
    expect(rows([shift('s2', '2026-11-18', '10:00', '17:30')], [])[0]?.status).toBe('upcoming');
    expect(rows([shift('s3', '2026-11-20')], [])[0]?.status).toBe('upcoming');
  });

  it('shows someone still clocked in, and approved or rejected time', () => {
    expect(rows([shift('s1', '2026-11-16')], [entry({ endTime: null })])[0]?.status).toBe(
      'clocked_in',
    );
    expect(rows([shift('s1', '2026-11-16')], [entry({ status: 'approved' })])[0]?.status).toBe(
      'approved',
    );
    expect(rows([shift('s1', '2026-11-16')], [entry({ status: 'rejected' })])[0]?.status).toBe(
      'rejected',
    );
  });
});

describe('once the period is authorised', () => {
  it('shows the authorised times', () => {
    const [row] = rows(
      [shift('s1', '2026-11-16')],
      [entry({ status: 'approved', source: 'roster', startTime: '10:00', endTime: '17:30' })],
      true,
    );
    expect(row).toMatchObject({ status: 'authorised', source: 'roster', entryId: 'e1' });
  });

  it('a shift with no time was not paid', () => {
    expect(rows([shift('s1', '2026-11-16')], [], true)[0]?.status).toBe('not_paid');
  });

  it('time worked without a shift has its own row', () => {
    const [row] = rows([], [entry({ shiftId: null, status: 'approved' })], true);
    expect(row).toMatchObject({ status: 'authorised', rostered: null });
  });
});
