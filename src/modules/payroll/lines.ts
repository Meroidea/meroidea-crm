import type { AwardPayLine } from '@/modules/awards';
import { awardPayFor, costOfShift } from '@/modules/roster/insights';
import { centsToAmount } from '@/modules/roster/rules';
import type { RosterRates, RosterRules } from '@/modules/roster/types';

/**
 * Turns the hours a person worked in a pay period into the lines of their payslip. Under an
 * award with written-down rules the lines are the award's (ordinary hours, Saturday, overtime,
 * allowances); otherwise they are the hours at the agreed rate, with the workspace's loading
 * for weekends and public holidays. Pure, so the same hours always give the same payslip.
 */

export type PayslipLineKind = 'ordinary' | 'penalty' | 'overtime' | 'allowance' | 'minimum';

export type PayslipLine = {
  title: string;
  kind: PayslipLineKind;
  /** Minutes paid at `rate`; null for an amount paid per occasion. */
  minutes: number | null;
  /** How many of a flat amount; null for hours. */
  units: number | null;
  /** Dollars per hour, or per occasion. */
  rate: string;
  /** The rate as a multiple of the ordinary hourly rate; null for flat amounts. */
  multiplier: string | null;
  amount: string;
  /** Counts towards superannuation: ordinary time earnings, so not overtime. */
  superable: boolean;
  /** The award clause, when the line comes from an award. */
  clause: string | null;
};

export type WorkedShift = {
  id: string;
  userId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  paidMinutes: number;
};

const toCents = (amount: string) => Math.round(Number(amount) * 100);

const KIND: Record<AwardPayLine['kind'], PayslipLineKind> = {
  ordinary: 'ordinary',
  saturday: 'penalty',
  sunday: 'penalty',
  publicHoliday: 'penalty',
  overtime: 'overtime',
  loading: 'allowance',
  allowance: 'allowance',
  minimumPayment: 'minimum',
};

const DAY_TITLE = {
  ordinary: 'Ordinary hours',
  saturday: 'Saturday',
  sunday: 'Sunday',
  publicHoliday: 'Public holiday',
} as const;

type Draft = Omit<PayslipLine, 'rate' | 'multiplier' | 'amount'> & {
  /** For a flat amount, what is owed. For hours it is worked out from the rate at the end. */
  cents: number;
  /** The published or agreed rate per hour or per occasion. */
  listedRate: string;
  /** Hours paid above the listed rate because the person's agreed rate is above the award. */
  aboveListed: boolean;
};

export function payslipLinesFor(input: {
  userId: string;
  /** The person's worked shifts in the period. */
  shifts: WorkedShift[];
  rates: RosterRates;
  rules: RosterRules;
  holidays: ReadonlySet<string>;
  weeks: number;
  /** Given when the shifts are approved timesheet time: what was rostered each day. */
  rosteredMinutesByDate?: Record<string, number>;
}): { lines: PayslipLine[]; grossCents: number; superableCents: number; warnings: string[] } {
  const own = input.shifts.filter((shift) => shift.userId === input.userId);
  const person = input.rates[input.userId];
  const drafts = new Map<string, Draft>();
  const add = (draft: Draft) => {
    const key = `${draft.title}|${draft.listedRate}`;
    const line = drafts.get(key);
    if (!line) return void drafts.set(key, { ...draft });
    line.cents += draft.cents;
    line.aboveListed ||= draft.aboveListed;
    if (draft.minutes !== null) line.minutes = (line.minutes ?? 0) + draft.minutes;
    if (draft.units !== null) line.units = (line.units ?? 0) + draft.units;
  };

  const pay = awardPayFor(
    input.userId,
    own,
    input.rates,
    input.holidays,
    input.weeks,
    input.rosteredMinutesByDate,
  );
  if (pay) {
    for (const line of pay.lines) {
      const each = toCents(line.rate);
      add({
        title: line.label,
        kind: KIND[line.kind],
        minutes: line.minutes,
        units: line.minutes === null ? (each > 0 ? Math.round(line.cents / each) : 1) : null,
        listedRate: line.rate,
        cents: line.costCents,
        aboveListed: line.costCents !== line.cents,
        superable: line.kind !== 'overtime',
        clause: line.clause,
      });
    }
  } else if (person) {
    for (const shift of own) {
      const cost = costOfShift(shift, input.rates, input.rules, input.holidays);
      if (cost.cents === null) continue;
      add({
        title: DAY_TITLE[cost.kind],
        kind: cost.kind === 'ordinary' ? 'ordinary' : 'penalty',
        minutes: shift.paidMinutes,
        units: null,
        // Two loadings for the same kind of day would be two lines.
        listedRate: (Number(person.hourly) * cost.loading).toFixed(4),
        cents: cost.cents,
        aboveListed: false,
        superable: true,
        clause: null,
      });
    }
  }

  // Each line of hours is settled once, on its total: the rate to the cent, then hours × rate,
  // so the figures on the payslip multiply out exactly rather than drifting by a cent a shift.
  const settled = [...drafts.values()].map((line) => {
    if (!line.minutes) return { line, rateCents: toCents(line.listedRate), cents: line.cents };
    const rateCents = line.aboveListed
      ? Math.round((line.cents * 60) / line.minutes)
      : Math.round(Number(line.listedRate) * 100);
    return { line, rateCents, cents: Math.round((line.minutes * rateCents) / 60) };
  });

  // The ordinary hourly rate everything else is a multiple of: what ordinary hours were paid
  // at, or the agreed rate when the period has none.
  const ordinary = settled.find((each) => each.line.kind === 'ordinary' && each.line.minutes);
  const baseCents = ordinary?.rateCents ?? (person ? toCents(person.hourly) : 0);

  const lines: PayslipLine[] = settled.map(({ line, rateCents, cents }) => {
    return {
      title: line.title,
      kind: line.kind,
      minutes: line.minutes,
      units: line.units,
      superable: line.superable,
      clause: line.clause,
      rate: centsToAmount(rateCents),
      multiplier: line.minutes && baseCents > 0 ? (rateCents / baseCents).toFixed(2) : null,
      amount: centsToAmount(cents),
    };
  });
  const total = (pick: (line: Draft) => boolean) =>
    settled.filter((each) => pick(each.line)).reduce((sum, each) => sum + each.cents, 0);
  return {
    lines,
    grossCents: total(() => true),
    superableCents: total((line) => line.superable),
    warnings: pay?.warnings.map((warning) => `${warning.message} (cl ${warning.clause})`) ?? [],
  };
}
