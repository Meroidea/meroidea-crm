import type { AwardEmployment, AwardRateSchedule } from '@/modules/hiring/award-rates';

/** One planned or worked block of time, in the workspace's wall-clock time. */
export type AwardShift = {
  id: string;
  /** The calendar day the shift starts on. */
  date: string;
  startTime: string;
  /** At or before the start time means the shift ends the next day. */
  endTime: string;
  /** Meal break time that is not paid. */
  unpaidBreakMinutes: number;
};

export type AwardPayKind =
  | 'ordinary'
  | 'saturday'
  | 'sunday'
  | 'publicHoliday'
  | 'overtime'
  | 'loading'
  | 'allowance'
  | 'minimumPayment';

/** One amount owed for one shift, with the clause it comes from. */
export type AwardPayLine = {
  shiftId: string;
  kind: AwardPayKind;
  /** What the amount is for, in plain words. */
  label: string;
  /** Minutes paid at `rate`; null for a flat amount. */
  minutes: number | null;
  /** Dollars per hour or per occasion, as published by the Commission. */
  rate: string;
  /** The award minimum for the line. */
  cents: number;
  /** The line at the person's agreed rate, where that is above the award; otherwise the same. */
  costCents: number;
  /** The award clause the line applies. */
  clause: string;
};

export type AwardWarning = { shiftId: string | null; message: string; clause: string };

export type AwardPayInput = {
  employment: AwardEmployment;
  /** The Commission's published rates for the person's classification and employment. */
  schedule: AwardRateSchedule;
  /** What the person is actually paid for an ordinary hour, when it is above the award. */
  agreedHourly: string | null;
  /** Every shift the person has in the roster period, not only the ones on screen. */
  shifts: AwardShift[];
  publicHolidays: ReadonlySet<string>;
  /** Weeks in the roster cycle, which sets the weekly ordinary-hours limit. */
  weeks: number;
  /** True when the person is known to be under 18. */
  under18: boolean;
  /**
   * Minutes the person was rostered for on each day, given only when `shifts` are hours
   * actually worked. Lets a rule that turns on working beyond the roster be applied.
   */
  rosteredMinutesByDate?: Record<string, number>;
};

export type AwardPay = {
  lines: AwardPayLine[];
  /** What the award requires as a minimum, in cents. */
  minimumCents: number;
  /** The same hours at the person's agreed rate where that is above the award. */
  costCents: number;
  /** Cost per shift, for showing on the roster. */
  costByShift: Record<string, number>;
  warnings: AwardWarning[];
};

export type AwardInterpreter = {
  code: string;
  name: string;
  /** The date the award text was consolidated to when these rules were written. */
  textAsAt: string;
  /** Parts of the award this does not apply; shown wherever its figures are. */
  notApplied: string[];
  pay: (input: AwardPayInput) => AwardPay;
};
