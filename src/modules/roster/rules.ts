/** Breaks and cost: the arithmetic shared by the roster screen and the service. */
import type { BreakRule, ShiftBreak } from '@/db/schema/roster';

export type { BreakRule, ShiftBreak };

/** Multipliers of the contract hourly rate: 1 is ordinary pay, 1.5 is time and a half. */
export type Loadings = { saturday: number; sunday: number; publicHoliday: number };

export type DayKind = 'ordinary' | 'saturday' | 'sunday' | 'publicHoliday';

export const ORDINARY_LOADINGS: Loadings = { saturday: 1, sunday: 1, publicHoliday: 1 };

/** Used until a workspace saves its own: a short paid rest, then a meal break on longer shifts. */
export const DEFAULT_BREAK_RULES: BreakRule[] = [
  { fromMinutes: 240, minutes: 10, paid: true },
  { fromMinutes: 300, minutes: 30, paid: false },
  { fromMinutes: 600, minutes: 10, paid: true },
];

export const TEAM_COLORS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'] as const;
export type TeamColor = (typeof TEAM_COLORS)[number];

const minutesOf = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};

/** Length of a shift given as wall-clock times; an end at or before the start runs overnight. */
export function shiftLength(startTime: string, endTime: string): number {
  if (!startTime || !endTime) return 0;
  const length = minutesOf(endTime) - minutesOf(startTime);
  return length <= 0 ? length + 1440 : length;
}

/** The breaks a shift of this length gets under the workspace's rules, shortest shift first. */
export function autoBreaks(lengthMinutes: number, rules: BreakRule[]): ShiftBreak[] {
  return [...rules]
    .filter((rule) => rule.fromMinutes <= lengthMinutes)
    .sort((a, b) => a.fromMinutes - b.fromMinutes)
    .map(({ minutes, paid }) => ({ minutes, paid }));
}

/** Break time that comes off the hours worked. */
export function unpaidMinutes(breaks: ShiftBreak[]): number {
  return breaks.reduce((sum, item) => sum + (item.paid ? 0 : item.minutes), 0);
}

/** "30m unpaid, 10m paid", or "No breaks". */
export function describeBreaks(breaks: ShiftBreak[]): string {
  if (breaks.length === 0) return 'No breaks';
  return breaks.map((item) => `${item.minutes}m ${item.paid ? 'paid' : 'unpaid'}`).join(', ');
}

/**
 * What kind of day a shift is costed as. The whole shift takes the rate of the day it starts
 * on; a listed public holiday wins over the weekend.
 */
export function dayKind(date: string, holidays: ReadonlySet<string>): DayKind {
  if (holidays.has(date)) return 'publicHoliday';
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (weekday === 6) return 'saturday';
  if (weekday === 0) return 'sunday';
  return 'ordinary';
}

export function loadingFor(kind: DayKind, loadings: Loadings): number {
  return kind === 'ordinary' ? 1 : loadings[kind];
}

/** A decimal amount such as "27.81" as whole cents, so cost is never floating-point money. */
const toCents = (amount: string) => {
  const [whole = '0', fraction = ''] = amount.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
};

/**
 * Paid hours × hourly rate × the day's loading, in whole cents. An estimate for planning: the
 * payslip is still worked out by the database from authorised hours.
 */
export function shiftCostCents(paidMinutes: number, hourlyRate: string, loading: number): number {
  // Award loadings are ratios of two published rates, so they carry more than two decimals.
  const scaled = Math.round(loading * 10_000);
  return Math.round((Math.max(0, paidMinutes) * toCents(hourlyRate) * scaled) / 600_000);
}

/** Whole cents as a decimal string for `formatMoney`. */
export function centsToAmount(cents: number): string {
  return `${Math.trunc(cents / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
}

export const DAY_KIND_LABEL: Record<DayKind, string> = {
  ordinary: 'Ordinary day',
  saturday: 'Saturday',
  sunday: 'Sunday',
  publicHoliday: 'Public holiday',
};
