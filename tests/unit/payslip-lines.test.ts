import { describe, expect, it } from 'vitest';

import { buildRateSchedule } from '@/modules/hiring/award-rates';
import { payslipLinesFor, type WorkedShift } from '@/modules/payroll/lines';
import { financialYearStart } from '@/modules/payroll/types';
import type { RosterRules } from '@/modules/roster/types';

import rows from '../fixtures/fwc-award-rows.json';

const rules: RosterRules = {
  loadings: { saturday: 1.25, sunday: 1.5, publicHoliday: 2.5 },
  breakRules: [],
  holidays: [],
};
const none = new Set<string>();

let next = 0;
const shift = (
  date: string,
  startTime: string,
  endTime: string,
  breakMinutes: number,
  paidMinutes: number,
): WorkedShift => ({
  id: `s${(next += 1)}`,
  userId: 'a',
  date,
  startTime,
  endTime,
  breakMinutes,
  paidMinutes,
});
const summary = (lines: ReturnType<typeof payslipLinesFor>['lines']) =>
  lines.map((line) => [
    line.title,
    line.minutes ?? line.units,
    line.rate,
    line.multiplier,
    line.amount,
  ]);

// October 2026: the 12th is a Monday.
describe('payslip lines for someone with no award rules', () => {
  const rates = { a: { hourly: '33.33', loadings: {} } };

  it('adds a period’s ordinary hours into one line, rounded once', () => {
    // 7h30m and 3h20m: 650 minutes at 33.33 is 361.075, paid as 361.08.
    const result = payslipLinesFor({
      userId: 'a',
      shifts: [
        shift('2026-10-12', '09:00', '17:00', 30, 450),
        shift('2026-10-13', '09:00', '12:20', 0, 200),
      ],
      rates,
      rules,
      holidays: none,
      weeks: 1,
    });
    expect(summary(result.lines)).toEqual([['Ordinary hours', 650, '33.33', '1.00', '361.08']]);
    expect(result).toMatchObject({ grossCents: 36108, superableCents: 36108 });
  });

  it('gives weekend hours their own line at the workspace’s loading', () => {
    const result = payslipLinesFor({
      userId: 'a',
      shifts: [
        shift('2026-10-16', '09:00', '13:00', 0, 240),
        shift('2026-10-18', '09:00', '13:00', 0, 240),
      ],
      rates: { a: { hourly: '30.00', loadings: {} } },
      rules,
      holidays: none,
      weeks: 1,
    });
    expect(summary(result.lines)).toEqual([
      ['Ordinary hours', 240, '30.00', '1.00', '120.00'],
      ['Sunday', 240, '45.00', '1.50', '180.00'],
    ]);
  });

  it('pays nothing, and says nothing, for someone with no rate', () => {
    const result = payslipLinesFor({
      userId: 'a',
      shifts: [shift('2026-10-12', '09:00', '13:00', 0, 240)],
      rates: {},
      rules,
      holidays: none,
      weeks: 1,
    });
    expect(result).toMatchObject({ lines: [], grossCents: 0 });
  });
});

describe('payslip lines under the Restaurant Industry Award', () => {
  const schedule = buildRateSchedule({
    awardCode: 'MA000119',
    classificationRef: 'x',
    employment: 'casual',
    payRate: rows.restaurantLevel1Adult.payRate,
    penalties: rows.restaurantLevel1Adult.penalties,
    allowances: rows.restaurantAllowances,
    today: '2026-10-13',
  });
  const award = { code: 'MA000119', employment: 'casual' as const, schedule, under18: false };
  const week = () => [
    ...['12', '13', '14', '15', '16'].map((day) =>
      shift(`2026-10-${day}`, '09:00', '17:30', 30, 480),
    ),
    shift('2026-10-17', '18:00', '23:00', 0, 300),
  ];

  it('lists ordinary hours, overtime past 38 hours and Saturday overtime, each at the award’s rate', () => {
    const result = payslipLinesFor({
      userId: 'a',
      shifts: week(),
      rates: { a: { hourly: '33.05', loadings: {}, award } },
      rules,
      holidays: none,
      weeks: 1,
    });
    expect(summary(result.lines)).toEqual([
      ['Ordinary hours', 2280, '33.05', '1.00', '1255.90'],
      ['Overtime, Monday to Friday, first 2 hours', 120, '39.66', '1.20', '79.32'],
      ['Overtime, Saturday, first 2 hours', 120, '46.27', '1.40', '92.54'],
      ['Overtime, Saturday, after 2 hours', 180, '52.88', '1.60', '158.64'],
    ]);
    expect(result.grossCents).toBe(125590 + 7932 + 9254 + 15864);
    // Super is on ordinary time earnings: the overtime is left out.
    expect(result.superableCents).toBe(125590);
  });

  it('keeps an above-award margin on each rate, and the lines still multiply out', () => {
    const result = payslipLinesFor({
      userId: 'a',
      shifts: [shift('2026-10-17', '12:00', '16:00', 0, 240)],
      rates: { a: { hourly: '36.00', loadings: {}, award } },
      rules,
      holidays: none,
      weeks: 1,
    });
    // The award's Saturday rate of 39.66 carries the same margin 36.00 has over 33.05.
    expect(summary(result.lines)).toEqual([['Saturday', 240, '43.20', '1.20', '172.80']]);
  });

  it('counts a flat amount in units, at the award’s figure', () => {
    const result = payslipLinesFor({
      userId: 'a',
      shifts: [shift('2026-10-13', '20:00', '23:30', 0, 210)],
      rates: { a: { hourly: '33.05', loadings: {}, award } },
      rules,
      holidays: none,
      weeks: 1,
    });
    expect(summary(result.lines)).toEqual([
      ['Ordinary hours', 210, '33.05', '1.00', '115.68'],
      ['10 pm to midnight, per hour or part', 2, '2.95', null, '5.90'],
    ]);
  });
});

describe('the financial year a payment falls in', () => {
  it('starts on 1 July in Australia and 1 January elsewhere', () => {
    expect(financialYearStart('2026-10-08', 'AU')).toBe('2026-07-01');
    expect(financialYearStart('2026-06-30', 'AU')).toBe('2025-07-01');
    expect(financialYearStart('2026-07-01', 'AU')).toBe('2026-07-01');
    expect(financialYearStart('2026-10-08', 'NZ')).toBe('2026-01-01');
    expect(financialYearStart('2026-10-08', null)).toBe('2026-01-01');
  });
});
