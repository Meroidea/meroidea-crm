import { describe, expect, it } from 'vitest';

import { awardInterpreter, type AwardShift } from '@/modules/awards';
import { readRates } from '@/modules/awards/ma000119';
import { buildRateSchedule, type AwardEmployment } from '@/modules/hiring/award-rates';

// The Commission's rows for rates operative from 1 July 2026.
import rows from '../fixtures/fwc-award-rows.json';

const award = awardInterpreter('MA000119');
if (!award) throw new Error('no interpreter for the Restaurant Industry Award');

type Sample = (typeof rows)['restaurantLevel1Adult'];
const scheduleFor = (sample: Sample, employment: AwardEmployment) =>
  buildRateSchedule({
    awardCode: 'MA000119',
    classificationRef: 'x',
    employment,
    payRate: sample.payRate,
    penalties: sample.penalties,
    allowances: rows.restaurantAllowances,
    today: '2026-10-13',
  });

let next = 0;
const shift = (
  date: string,
  startTime: string,
  endTime: string,
  unpaidBreakMinutes = 0,
): AwardShift => ({
  id: `s${(next += 1)}`,
  date,
  startTime,
  endTime,
  unpaidBreakMinutes,
});

const payFor = (
  employment: AwardEmployment,
  shifts: AwardShift[],
  options: {
    sample?: Sample;
    agreedHourly?: string;
    holidays?: string[];
    weeks?: number;
    under18?: boolean;
    rostered?: Record<string, number>;
  } = {},
) =>
  award.pay({
    employment,
    schedule: scheduleFor(options.sample ?? rows.restaurantLevel1Adult, employment),
    agreedHourly: options.agreedHourly ?? null,
    shifts,
    publicHolidays: new Set(options.holidays ?? []),
    weeks: options.weeks ?? 1,
    under18: options.under18 ?? false,
    ...(options.rostered ? { rosteredMinutesByDate: options.rostered } : {}),
  });
const summary = (result: ReturnType<typeof payFor>) =>
  result.lines.map((line) => [line.label, line.minutes, line.rate, line.cents, line.clause]);

// October 2026: the 12th is a Monday.
describe('Restaurant Industry Award: the rates the rules rely on', () => {
  it('finds every rate in the Commission’s rows for a Level 1 adult', () => {
    expect(readRates(scheduleFor(rows.restaurantLevel1Adult, 'full_time'))).toEqual({
      ordinary: '26.44',
      saturday: '33.05',
      sunday: '39.66',
      publicHoliday: '59.49',
      overtimeWeekdayFirst: '39.66',
      overtimeWeekdayAfter: '52.88',
      overtimeSaturdayFirst: '46.27',
      overtimeSaturdayAfter: '52.88',
      overtimeSunday: '52.88',
      evening: '2.95',
      night: '4.42',
      splitShift: '5.60',
    });
  });

  it('works nothing out when a rate is missing, and says which', () => {
    const schedule = { ...scheduleFor(rows.restaurantLevel1Adult, 'casual'), groups: [] };
    const result = award.pay({
      employment: 'casual',
      schedule,
      agreedHourly: null,
      shifts: [shift('2026-10-14', '10:00', '14:00')],
      publicHolidays: new Set(),
      weeks: 1,
      under18: false,
    });
    expect(result).toMatchObject({ minimumCents: 0, lines: [] });
    expect(result.warnings[0]?.message).toMatch(/does not list every rate/);
  });
});

describe('Restaurant Industry Award: ordinary hours and penalties (cl 24)', () => {
  it('pays a full-timer the ordinary rate for a weekday, less the unpaid meal break', () => {
    const result = payFor('full_time', [shift('2026-10-14', '10:00', '18:00', 30)]);
    expect(summary(result)).toEqual([['Ordinary hours', 450, '26.44', 19830, '18']]);
    expect(result.warnings).toEqual([]);
  });

  it('pays the real hours on the night clocks go forward, not the wall-clock span', () => {
    // 10 pm to 6 am across the start of daylight saving is 7 real hours, not 8.
    const overnight = { ...shift('2026-10-03', '22:00', '06:00', 0), elapsedMinutes: 420 };
    const paid = payFor('full_time', [overnight]).lines.reduce(
      (sum, line) => sum + line.minutes,
      0,
    );
    expect(paid).toBe(420);
  });

  it('pays a casual the loaded rate, and the Saturday rate on a Saturday', () => {
    const result = payFor('casual', [shift('2026-10-17', '12:00', '16:00')]);
    expect(summary(result)).toEqual([['Saturday', 240, '39.66', 15864, '24.2']]);
  });

  it('pays a Level 3 to 6 casual the higher Sunday rate', () => {
    const result = payFor('casual', [shift('2026-10-18', '12:00', '16:00')], {
      sample: rows.restaurantLevel4Adult,
    });
    expect(summary(result)).toEqual([['Sunday', 240, '51.54', 20616, '24.2']]);
  });

  it('changes rate at midnight and adds the late-evening amount for each hour or part', () => {
    // Friday 6 pm to 1 am Saturday with a 30 minute break: 5.5 ordinary hours on Friday,
    // two of them after 10 pm, then one Saturday hour.
    const result = payFor('full_time', [shift('2026-10-16', '18:00', '01:00', 30)]);
    expect(summary(result)).toEqual([
      ['Ordinary hours', 330, '26.44', 14542, '18'],
      ['Saturday', 60, '33.05', 3305, '24.2'],
      ['10 pm to midnight, per hour or part', null, '2.95', 590, '24.2'],
    ]);
    expect(result.minimumCents).toBe(18437);
  });

  it('counts part of an hour as a whole hour for the night amounts', () => {
    // Tuesday 11.30 pm to 2.15 am Wednesday: half an hour before midnight, 2.25 hours after.
    const result = payFor('casual', [shift('2026-10-13', '23:30', '02:15')]);
    expect(summary(result)).toEqual([
      ['Ordinary hours', 165, '33.05', 9089, '11.1'],
      ['10 pm to midnight, per hour or part', null, '2.95', 295, '24.2'],
      ['Midnight to 6 am, per hour or part', null, '4.42', 1326, '24.2'],
    ]);
  });

  it('pays the public holiday rate, with no evening amount on top (cl 24.3)', () => {
    const result = payFor('full_time', [shift('2026-10-12', '18:00', '23:00')], {
      holidays: ['2026-10-12'],
    });
    expect(summary(result)).toEqual([['Public holiday', 300, '59.49', 29745, '24.2']]);
  });
});

describe('Restaurant Industry Award: overtime (cl 23)', () => {
  it('pays overtime after 11.5 ordinary hours in a day, in two bands', () => {
    // 8 am to 10.30 pm with a 30 minute break is 14 hours worked: 11.5 ordinary to 8 pm,
    // then 2 hours at the first rate and half an hour at the second. No evening amount on overtime.
    const result = payFor('full_time', [shift('2026-10-12', '08:00', '22:30', 30)]);
    expect(summary(result)).toEqual([
      ['Ordinary hours', 690, '26.44', 30406, '18'],
      ['Overtime, Monday to Friday, first 2 hours', 120, '39.66', 7932, '23.4'],
      ['Overtime, Monday to Friday, after 2 hours', 30, '52.88', 2644, '23.4'],
    ]);
  });

  it('pays overtime past 38 hours in the week, on the hours that go over', () => {
    const week = ['12', '13', '14', '15', '16'].map((day) =>
      shift(`2026-10-${day}`, '09:00', '17:30', 30),
    );
    const result = payFor('casual', week);
    expect(result.lines.filter((line) => line.kind === 'overtime')).toMatchObject([
      { shiftId: week[4]?.id, minutes: 120, rate: '39.66', cents: 7932 },
    ]);
    // 38 hours at $33.05 and 2 at $39.66.
    expect(result.minimumCents).toBe(125590 + 7932);
  });

  it('averages the 38 hours over a two-week roster', () => {
    const week = ['12', '13', '14', '15', '16'].map((day) =>
      shift(`2026-10-${day}`, '09:00', '17:30', 30),
    );
    const result = payFor('casual', week, { weeks: 2 });
    expect(result.lines.some((line) => line.kind === 'overtime')).toBe(false);
  });

  it('lets a casual work 12 hours before daily overtime starts', () => {
    const result = payFor('casual', [shift('2026-10-14', '08:00', '21:30', 30)]);
    expect(summary(result)).toEqual([
      ['Ordinary hours', 720, '33.05', 39660, '11.1'],
      ['Overtime, Monday to Friday, first 2 hours', 60, '39.66', 3966, '23.4'],
    ]);
    expect(result.warnings.map((warning) => warning.clause)).toContain('11.2(a)');
  });
});

describe('Restaurant Industry Award: hours actually worked by a part-timer (cl 10.13(b)(iii))', () => {
  it('pays overtime for time worked beyond the rostered hours that day', () => {
    // Rostered 10 am to 2 pm, worked until 5 pm: four ordinary hours, then three of overtime.
    const result = payFor('part_time', [shift('2026-10-14', '10:00', '17:00')], {
      rostered: { '2026-10-14': 240 },
    });
    expect(summary(result)).toEqual([
      ['Ordinary hours', 240, '26.44', 10576, '18'],
      ['Overtime, Monday to Friday, first 2 hours', 120, '39.66', 7932, '23.4'],
      ['Overtime, Monday to Friday, after 2 hours', 60, '52.88', 5288, '23.4'],
    ]);
  });

  it('pays overtime for all of a day the part-timer was not rostered on', () => {
    const result = payFor('part_time', [shift('2026-10-15', '10:00', '13:00')], {
      rostered: { '2026-10-14': 240 },
    });
    expect(result.lines.map((line) => line.kind)).toEqual(['overtime', 'overtime']);
  });

  it('does not apply to a casual or a full-timer, or to a roster with no worked hours', () => {
    const rostered = { '2026-10-14': 240 };
    for (const employment of ['casual', 'full_time'] as const) {
      const result = payFor(employment, [shift('2026-10-14', '10:00', '17:00', 30)], { rostered });
      expect(result.lines.some((line) => line.kind === 'overtime')).toBe(false);
    }
    expect(
      payFor('part_time', [shift('2026-10-14', '10:00', '17:00', 30)]).lines.some(
        (line) => line.kind === 'overtime',
      ),
    ).toBe(false);
  });
});

describe('Restaurant Industry Award: minimum payments and allowances', () => {
  it('pays a casual for at least 2 hours each time they come in (cl 11.3)', () => {
    const result = payFor('casual', [shift('2026-10-14', '12:00', '13:00')]);
    expect(summary(result)).toEqual([
      ['Ordinary hours', 60, '33.05', 3305, '11.1'],
      ['Casual minimum of 2h', 60, '33.05', 3305, '11.3'],
    ]);
  });

  it('pays at least 4 hours to a permanent and 2 to a casual on a public holiday (cl 24.4)', () => {
    const holidays = ['2026-10-12'];
    expect(
      payFor('casual', [shift('2026-10-12', '12:00', '13:00')], { holidays }).minimumCents,
    ).toBe(13220);
    expect(
      payFor('part_time', [shift('2026-10-12', '12:00', '15:00')], { holidays }).minimumCents,
    ).toBe(4 * 5949);
  });

  it('pays the split shift allowance for each work period of 2 hours or more, but not to a casual', () => {
    const broken = () => [
      shift('2026-10-15', '10:00', '14:00'),
      shift('2026-10-15', '17:00', '21:00'),
    ];
    const permanent = payFor('full_time', broken());
    expect(permanent.lines.filter((line) => line.kind === 'allowance')).toMatchObject([
      { label: 'Split shift allowance', rate: '5.60', cents: 560, clause: '21.3(b)' },
      { label: 'Split shift allowance', rate: '5.60', cents: 560, clause: '21.3(b)' },
    ]);
    expect(permanent.minimumCents).toBe(8 * 2644 + 1120);
    expect(payFor('casual', broken()).lines.some((line) => line.kind === 'allowance')).toBe(false);
  });
});

describe('Restaurant Industry Award: what the roster is costed at', () => {
  it('keeps an above-award margin on every rate, and never costs below the award', () => {
    const saturday = () => [shift('2026-10-17', '12:00', '16:00')];
    const above = payFor('casual', saturday(), { agreedHourly: '36.00' });
    expect(above).toMatchObject({ minimumCents: 15864, costCents: 17281 });
    const below = payFor('casual', saturday(), { agreedHourly: '30.00' });
    expect(below).toMatchObject({ minimumCents: 15864, costCents: 15864 });
  });

  it('gives the cost shift by shift, adding up to the total', () => {
    const shifts = [shift('2026-10-15', '10:00', '14:00'), shift('2026-10-15', '17:00', '21:00')];
    const result = payFor('full_time', shifts);
    expect(Object.values(result.costByShift).reduce((sum, cents) => sum + cents, 0)).toBe(
      result.costCents,
    );
    expect(result.costByShift[shifts[0]?.id ?? '']).toBe(4 * 2644 + 560);
  });
});

describe('Restaurant Industry Award: rostering limits it warns about', () => {
  const clauses = (result: ReturnType<typeof payFor>) =>
    result.warnings.map((warning) => warning.clause);

  it('flags a long shift with no meal break', () => {
    expect(clauses(payFor('casual', [shift('2026-10-14', '10:00', '16:00')]))).toEqual(['16.2']);
  });

  it('flags a part-timer rostered for under 3 hours and a full-timer for under 6', () => {
    expect(clauses(payFor('part_time', [shift('2026-10-14', '10:00', '12:00')]))).toEqual([
      '10.7(b)',
    ]);
    expect(clauses(payFor('full_time', [shift('2026-10-14', '10:00', '14:00')]))).toEqual([
      '15.1(a)',
    ]);
  });

  it('flags under 10 hours between days for a permanent, but not for a casual', () => {
    const close = () => [
      shift('2026-10-13', '15:00', '23:00', 30),
      shift('2026-10-14', '07:00', '15:00', 30),
    ];
    expect(clauses(payFor('full_time', close()))).toEqual(['15.1(e)']);
    expect(clauses(payFor('casual', close()))).toEqual([]);
  });

  it('flags a shift over 10 hours for someone under 18, and a split day spread over 12 hours', () => {
    expect(
      clauses(payFor('casual', [shift('2026-10-14', '08:00', '19:00', 30)], { under18: true })),
    ).toEqual(['13.3']);
    expect(
      clauses(
        payFor('full_time', [
          shift('2026-10-15', '07:00', '11:00'),
          shift('2026-10-15', '16:00', '20:00'),
        ]),
      ),
    ).toEqual(['15.1(g)']);
  });
});
