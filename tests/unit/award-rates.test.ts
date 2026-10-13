import { describe, expect, it } from 'vitest';

import {
  buildRateSchedule,
  dayLoadings,
  type AwardEmployment,
  type RawAllowance,
  type RawPayRate,
  type RawPenalty,
} from '@/modules/hiring/award-rates';

// Rows as the Fair Work Commission's pay database returned them for rates operative from
// 1 July 2026 (Restaurant MA000119, General Retail MA000004, Clerks MA000002).
import rows from '../fixtures/fwc-award-rows.json';

type Sample = { payRate: RawPayRate; penalties: RawPenalty[] };

const schedule = (sample: Sample, employment: AwardEmployment, allowances: RawAllowance[] = []) =>
  buildRateSchedule({
    awardCode: 'MA000119',
    classificationRef: '1',
    employment,
    payRate: sample.payRate,
    penalties: sample.penalties,
    allowances,
    today: '2026-10-13',
  });

describe('the minimum for an ordinary hour', () => {
  it('is the base rate for a full-time or part-time adult', () => {
    const result = schedule(rows.restaurantLevel1Adult, 'part_time');
    expect(result).toMatchObject({
      employeeKind: 'adult',
      baseHourly: '26.44',
      baseWeekly: '1004.90',
      minimumHourly: '26.44',
      operativeFrom: '2026-07-01',
    });
  });

  it('includes the casual loading for a casual, taken from the published casual rate', () => {
    const result = schedule(rows.restaurantLevel1Adult, 'casual');
    expect(result.baseHourly).toBe('26.44');
    expect(result.minimumHourly).toBe('33.05');
    expect(result.minimumBasis).toContain('Casual adult employees');
    expect(result.minimumBasis).toContain('125%');
  });

  it('uses the junior rate for a junior, derived from the weekly figure the award publishes', () => {
    const permanent = schedule(rows.restaurantIntro19, 'full_time');
    expect(permanent).toMatchObject({ employeeKind: 'junior', minimumHourly: '21.88' });
    expect(schedule(rows.restaurantIntro19, 'casual').minimumHourly).toBe('27.35');
  });

  it('says so, rather than guessing, when no casual rate is published', () => {
    const result = schedule(
      { payRate: rows.restaurantLevel1Adult.payRate, penalties: [] },
      'casual',
    );
    expect(result.minimumHourly).toBeNull();
    expect(result.minimumBasis).toMatch(/no casual rate/);
  });
});

describe('the rate tables shown for a classification', () => {
  it('shows a casual only the casual tables, ordinary rates first', () => {
    const titles = schedule(rows.restaurantLevel1Adult, 'casual').groups.map(
      (group) => group.title,
    );
    expect(titles).toEqual([
      'Casual adult employees—ordinary and penalty rates',
      'Casual adult employees—overtime rates',
    ]);
  });

  it('leaves out a rate the award lists for a different level', () => {
    // Level 1 casuals get 150% on a Sunday; the 175% row is for Level 3 and above.
    const [ordinary] = schedule(rows.restaurantLevel1Adult, 'casual').groups;
    expect(ordinary?.lines.map((line) => [line.description, line.hourly])).toEqual([
      ['Ordinary hours', '33.05'],
      ['Saturday', '39.66'],
      ['Sunday - Introductory to Level 2', '39.66'],
      ['Public holiday', '66.10'],
    ]);
    const [higher] = schedule(rows.restaurantLevel4Adult, 'casual').groups;
    expect(higher?.lines.find((line) => line.description.startsWith('Sunday'))).toMatchObject({
      description: 'Sunday - Level 3 to 6',
      percent: 175,
      hourly: '51.54',
    });
  });

  it('carries the award’s allowances with their amounts and clauses', () => {
    const result = schedule(rows.restaurantLevel1Adult, 'full_time', rows.restaurantAllowances);
    expect(result.allowances).toHaveLength(7);
    expect(result.allowances[0]).toMatchObject({
      name: 'Penalty—Monday to Friday—10.00 pm to midnight',
      amount: '2.95',
      clause: '24.2',
    });
  });
});

describe('whole-day rates used to cost a roster', () => {
  it('reads Saturday, Sunday and public holiday for a permanent and for a casual', () => {
    expect(schedule(rows.restaurantLevel1Adult, 'full_time').dayRates).toEqual({
      ordinary: '26.44',
      saturday: '33.05',
      sunday: '39.66',
      publicHoliday: '59.49',
    });
    const casual = schedule(rows.restaurantLevel4Adult, 'casual').dayRates;
    expect(casual).toEqual({
      ordinary: '36.81',
      saturday: '44.18',
      sunday: '51.54',
      publicHoliday: '73.63',
    });
    expect(dayLoadings(casual)).toEqual({
      saturday: 1.2002,
      sunday: 1.4002,
      publicHoliday: 2.0003,
    });
  });

  it('treats “other than shiftworkers” as the ordinary table, not as shift work', () => {
    const retail = schedule(rows.retail, 'casual');
    expect(retail.groups[0]?.title).toBe(
      'Casual adult employees other than shiftworkers—ordinary and penalty rates',
    );
    expect(retail.minimumHourly).toBe('35.56');
    expect(retail.dayRates).toMatchObject({ ordinary: '35.56', saturday: '42.68' });
  });

  it('works where the award words the ordinary rate differently', () => {
    // The Clerks award calls its ordinary row "Monday to Friday".
    const clerks = schedule(rows.clerks, 'full_time');
    expect(clerks.minimumHourly).toBe('28.24');
    expect(clerks.dayRates).toEqual({
      ordinary: '28.24',
      saturday: '35.30',
      sunday: '56.48',
      publicHoliday: '70.60',
    });
  });

  it('gives no day loadings when there is nothing to read them from', () => {
    expect(dayLoadings(null)).toEqual({});
    expect(
      schedule({ payRate: rows.retail.payRate, penalties: [] }, 'full_time').dayRates,
    ).toBeNull();
  });
});
