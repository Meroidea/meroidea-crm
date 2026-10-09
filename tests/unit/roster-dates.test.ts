import { describe, expect, it } from 'vitest';

import {
  addDaysToDate,
  daysBetweenDates,
  instantToZoned,
  mondayOf,
  zonedDateTimeToInstant,
} from '@/lib/dates';
import { formatHours, positionCode, positionTone } from '@/modules/roster/hours';
import { saveShiftSchema } from '@/modules/roster/schemas';

const SYDNEY = 'Australia/Sydney';

describe('workspace wall-clock time', () => {
  it('turns a local date and time into the right instant, in and out of daylight saving', () => {
    // Sydney is UTC+10 in July and UTC+11 in January.
    expect(zonedDateTimeToInstant(SYDNEY, '2026-07-15', '09:30').toISOString()).toBe(
      '2026-07-14T23:30:00.000Z',
    );
    expect(zonedDateTimeToInstant(SYDNEY, '2026-01-15', '09:30').toISOString()).toBe(
      '2026-01-14T22:30:00.000Z',
    );
  });

  it('gets the morning after a daylight-saving changeover right', () => {
    // Clocks went forward at 02:00 on Sunday 4 October 2026.
    expect(zonedDateTimeToInstant(SYDNEY, '2026-10-04', '09:00').toISOString()).toBe(
      '2026-10-03T22:00:00.000Z',
    );
    expect(zonedDateTimeToInstant(SYDNEY, '2026-10-03', '23:00').toISOString()).toBe(
      '2026-10-03T13:00:00.000Z',
    );
  });

  it('reads an instant back as the same local date and time', () => {
    const instant = zonedDateTimeToInstant(SYDNEY, '2026-10-08', '17:45');
    expect(instantToZoned(SYDNEY, instant)).toEqual({ date: '2026-10-08', time: '17:45' });
  });
});

describe('plain calendar dates', () => {
  it('adds days across month and year ends', () => {
    expect(addDaysToDate('2026-10-28', 6)).toBe('2026-11-03');
    expect(addDaysToDate('2026-12-29', 13)).toBe('2027-01-11');
    expect(addDaysToDate('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts whole days between two dates', () => {
    expect(daysBetweenDates('2026-10-05', '2026-10-11')).toBe(6);
    expect(daysBetweenDates('2026-10-05', '2026-10-18')).toBe(13);
  });

  it('finds the Monday on or before a date', () => {
    expect(mondayOf('2026-10-08')).toBe('2026-10-05');
    expect(mondayOf('2026-10-05')).toBe('2026-10-05');
    expect(mondayOf('2026-10-11')).toBe('2026-10-05');
  });
});

describe('shift display helpers', () => {
  it('formats worked time without trailing zeros', () => {
    expect(formatHours(450)).toBe('7.5h');
    expect(formatHours(480)).toBe('8h');
    expect(formatHours(0)).toBe('0h');
  });

  it('abbreviates a tag to a short code', () => {
    expect(positionCode('Front desk')).toBe('FD');
    expect(positionCode('support')).toBe('SU');
    expect(positionCode(null)).toBe('');
  });

  it('gives the same tag the same colour regardless of case', () => {
    expect(positionTone('Front desk')).toBe(positionTone('front DESK'));
  });
});

describe('shift form validation', () => {
  const base = {
    rosterId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    date: '2026-10-08',
    startTime: '09:00',
    endTime: '17:00',
  };

  it('accepts a break typed into a form field and blank optional text', () => {
    const parsed = saveShiftSchema.parse({ ...base, breakMinutes: '30', position: '  ', note: '' });
    expect(parsed).toMatchObject({ breakMinutes: 30, position: null, note: null });
  });

  it('accepts its own output, because the action re-validates what the form already parsed', () => {
    const once = saveShiftSchema.parse({ ...base, breakMinutes: '30', position: '', note: '' });
    expect(saveShiftSchema.parse(once)).toEqual(once);
  });

  it('rejects a malformed time and a negative break', () => {
    expect(saveShiftSchema.safeParse({ ...base, startTime: '9am' }).success).toBe(false);
    expect(saveShiftSchema.safeParse({ ...base, breakMinutes: -5 }).success).toBe(false);
  });
});
