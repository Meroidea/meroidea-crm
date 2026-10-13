import { describe, expect, it } from 'vitest';

import { costOfShift, shiftWarnings } from '@/modules/roster/insights';
import { rosterEmail } from '@/modules/roster/notify';
import {
  autoBreaks,
  centsToAmount,
  dayKind,
  DEFAULT_BREAK_RULES,
  describeBreaks,
  loadingFor,
  shiftCostCents,
  shiftLength,
  unpaidMinutes,
} from '@/modules/roster/rules';
import type { RosterRules } from '@/modules/roster/types';

const rules: RosterRules = {
  loadings: { saturday: 1.25, sunday: 1.5, publicHoliday: 2.5 },
  breakRules: DEFAULT_BREAK_RULES,
  holidays: [{ id: 'h', day: '2026-10-05', name: 'Labour Day' }],
};
const holidays = new Set(rules.holidays.map((holiday) => holiday.day));

describe('automatic breaks', () => {
  it('gives a short shift none, and adds breaks as the shift gets longer', () => {
    expect(autoBreaks(180, DEFAULT_BREAK_RULES)).toEqual([]);
    expect(autoBreaks(240, DEFAULT_BREAK_RULES)).toEqual([{ minutes: 10, paid: true }]);
    expect(autoBreaks(450, DEFAULT_BREAK_RULES)).toEqual([
      { minutes: 10, paid: true },
      { minutes: 30, paid: false },
    ]);
    expect(autoBreaks(630, DEFAULT_BREAK_RULES)).toHaveLength(3);
  });

  it('takes only unpaid breaks off the hours worked', () => {
    const breaks = autoBreaks(450, DEFAULT_BREAK_RULES);
    expect(unpaidMinutes(breaks)).toBe(30);
    expect(describeBreaks(breaks)).toBe('10m paid, 30m unpaid');
    expect(describeBreaks([])).toBe('No breaks');
  });

  it('measures a shift that runs past midnight', () => {
    expect(shiftLength('09:00', '17:30')).toBe(510);
    expect(shiftLength('22:00', '06:00')).toBe(480);
    expect(shiftLength('', '06:00')).toBe(0);
  });
});

describe('costing a shift', () => {
  it('knows a weekend from a weekday, and lets a public holiday win', () => {
    expect(dayKind('2026-10-07', holidays)).toBe('ordinary');
    expect(dayKind('2026-10-10', holidays)).toBe('saturday');
    expect(dayKind('2026-10-11', holidays)).toBe('sunday');
    // Monday 5 October is listed as a holiday.
    expect(dayKind('2026-10-05', holidays)).toBe('publicHoliday');
    expect(loadingFor('ordinary', rules.loadings)).toBe(1);
    expect(loadingFor('sunday', rules.loadings)).toBe(1.5);
  });

  it('multiplies paid hours by the rate and the loading, to the cent', () => {
    expect(shiftCostCents(420, '27.81', 1)).toBe(19467);
    expect(shiftCostCents(420, '27.81', 1.5)).toBe(29201);
    expect(shiftCostCents(240, '25', 2.5)).toBe(25000);
    expect(shiftCostCents(-30, '25', 1)).toBe(0);
    // A casual on exactly the award's $36.81 costs the award's $44.18 an hour on a Saturday.
    expect(shiftCostCents(60, '36.81', 1.2002)).toBe(4418);
    expect(centsToAmount(19467)).toBe('194.67');
    expect(centsToAmount(5)).toBe('0.05');
  });

  it('costs nothing for a vacant shift or a person with no hourly rate', () => {
    const shift = { date: '2026-10-11', paidMinutes: 240 };
    expect(
      costOfShift(
        { ...shift, userId: 'a' },
        { a: { hourly: '30.00', loadings: {} } },
        rules,
        holidays,
      ),
    ).toMatchObject({
      cents: 18000,
      kind: 'sunday',
      loading: 1.5,
    });
    expect(
      costOfShift(
        { ...shift, userId: null },
        { a: { hourly: '30.00', loadings: {} } },
        rules,
        holidays,
      ).cents,
    ).toBeNull();
    expect(
      costOfShift(
        { ...shift, userId: 'b' },
        { a: { hourly: '30.00', loadings: {} } },
        rules,
        holidays,
      ).cents,
    ).toBeNull();
  });
});

describe('shift warnings', () => {
  const context = {
    today: '2026-10-08',
    rates: null,
    leave: [
      {
        userId: 'a',
        startsOn: '2026-10-09',
        endsOn: '2026-10-10',
        status: 'pending' as const,
        typeName: 'Annual leave',
      },
    ],
  };
  const shift = { userId: 'a', date: '2026-10-12', published: true, unpublishedChanges: false };

  it('says nothing about an ordinary published shift', () => {
    expect(shiftWarnings(shift, context)).toEqual([]);
  });

  it('flags a vacant shift, leave on the day, and an unpublished shift already in the past', () => {
    expect(shiftWarnings({ ...shift, userId: null }, context)).toEqual([
      'Nobody is on this shift yet.',
    ]);
    expect(shiftWarnings({ ...shift, date: '2026-10-09' }, context)[0]).toMatch(/asked for leave/);
    expect(
      shiftWarnings(
        { ...shift, date: '2026-10-06', published: false, unpublishedChanges: true },
        context,
      ),
    ).toEqual(['Starts before today and has not been published.']);
  });

  it('flags a missing rate only for someone who is shown pay', () => {
    expect(shiftWarnings(shift, { ...context, rates: {} })[0]).toMatch(/not costed/);
    expect(
      shiftWarnings(shift, { ...context, rates: { a: { hourly: '30.00', loadings: {} } } }),
    ).toEqual([]);
  });
});

describe('the roster email', () => {
  const base = {
    workspace: 'Harbour <Cafe>',
    fullName: 'Max Member',
    startsOn: '2026-10-05',
    endsOn: '2026-10-11',
    message: null,
  };

  it('lists the person’s own shifts and escapes what goes into the HTML', () => {
    const email = rosterEmail({
      ...base,
      shifts: [{ date: '2026-10-06', startTime: '10:00', endTime: '17:30', team: 'Floor' }],
      message: 'See you <there>',
    });
    expect(email.subject).toBe('Your roster for 5 Oct to 11 Oct');
    expect(email.text).toContain('Tue 6 Oct: 10:00 to 17:30 (Floor)');
    expect(email.html).toContain('Harbour &lt;Cafe&gt;');
    expect(email.html).toContain('See you &lt;there&gt;');
    expect(email.html).not.toContain('<there>');
  });

  it('tells someone with no shifts left that they have none', () => {
    expect(rosterEmail({ ...base, shifts: [] }).text).toContain('You have no shifts');
  });
});
