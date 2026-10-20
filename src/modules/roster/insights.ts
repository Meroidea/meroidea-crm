import {
  awardInterpreter,
  type AwardPay,
  type AwardPayLine,
  type AwardWarning,
} from '@/modules/awards';

import { dayKind, loadingFor, shiftCostCents, type DayKind } from './rules';
import type { RosterLeave, RosterRates, RosterRules, RosterShift } from './types';

export type ShiftCost = {
  /** Null when the shift is vacant or the person has no hourly contract rate. */
  cents: number | null;
  rate: string | null;
  kind: DayKind;
  loading: number;
  /** Whether the loading is the award's published rate or the workspace's own setting. */
  source: 'award' | 'workspace';
};

/** What a shift costs under the workspace's loadings, from the day it starts on. */
export function costOfShift(
  shift: Pick<RosterShift, 'userId' | 'date' | 'paidMinutes'>,
  rates: RosterRates,
  rules: RosterRules,
  holidays: ReadonlySet<string>,
): ShiftCost {
  const kind = dayKind(shift.date, holidays);
  const person = shift.userId ? (rates[shift.userId] ?? null) : null;
  // The person's award decides the day's loading where it publishes one; otherwise the workspace's.
  const fromAward = kind === 'ordinary' ? undefined : person?.loadings[kind];
  const loading = fromAward ?? loadingFor(kind, rules.loadings);
  return {
    cents: person === null ? null : shiftCostCents(shift.paidMinutes, person.hourly, loading),
    rate: person?.hourly ?? null,
    kind,
    loading,
    source: fromAward === undefined ? 'workspace' : 'award',
  };
}

/** Time away that covers the day a shift starts on, for the person on it. */
export function leaveOn(
  leave: RosterLeave[],
  userId: string | null,
  date: string,
): RosterLeave | undefined {
  if (!userId) return undefined;
  return leave.find(
    (item) => item.userId === userId && item.startsOn <= date && item.endsOn >= date,
  );
}

/** Things worth a second look before a shift is published. Never blocks saving. */
export function shiftWarnings(
  shift: Pick<RosterShift, 'userId' | 'date' | 'published' | 'unpublishedChanges'>,
  context: { leave: RosterLeave[]; today: string; rates: RosterRates | null },
): string[] {
  const warnings: string[] = [];
  if (!shift.userId) warnings.push('Nobody is on this shift yet.');
  const away = leaveOn(context.leave, shift.userId, shift.date);
  if (away) {
    warnings.push(
      away.status === 'approved'
        ? `On approved leave this day (${away.typeName}).`
        : `Has asked for leave this day (${away.typeName}), not yet decided.`,
    );
  }
  if (shift.unpublishedChanges && shift.date < context.today) {
    warnings.push(
      shift.published
        ? 'Changed after the day had passed, and not published since.'
        : 'Starts before today and has not been published.',
    );
  }
  if (context.rates && shift.userId && !context.rates[shift.userId]) {
    warnings.push('No accepted hourly contract, so this shift is not costed.');
  }
  return warnings;
}

export type ShiftCosting = {
  /** Null when the shift is vacant or the person has no hourly contract rate. */
  cents: number | null;
  /** `award`: worked out by the award's rules. `rate`: hours × rate × the day's loading. */
  basis: 'award' | 'rate';
  lines: AwardPayLine[];
  warnings: AwardWarning[];
};

type CostedShift = Pick<
  RosterShift,
  'id' | 'userId' | 'date' | 'startTime' | 'endTime' | 'breakMinutes' | 'paidMinutes'
>;

/** One person's pay under their award for every shift they have in the roster period. */
export function awardPayFor(
  userId: string,
  shifts: CostedShift[],
  rates: RosterRates,
  holidays: ReadonlySet<string>,
  weeks: number,
  /** Given when `shifts` are hours actually worked: what the person was rostered for each day. */
  rosteredMinutesByDate?: Record<string, number>,
): AwardPay | null {
  const person = rates[userId];
  const interpreter = awardInterpreter(person?.award?.code);
  if (!person?.award || !interpreter) return null;
  return interpreter.pay({
    employment: person.award.employment,
    schedule: person.award.schedule,
    agreedHourly: person.hourly,
    under18: person.award.under18,
    publicHolidays: holidays,
    weeks,
    ...(rosteredMinutesByDate ? { rosteredMinutesByDate } : {}),
    shifts: shifts
      .filter((shift) => shift.userId === userId)
      .map((shift) => ({
        id: shift.id,
        date: shift.date,
        startTime: shift.startTime,
        endTime: shift.endTime,
        unpaidBreakMinutes: shift.breakMinutes,
        elapsedMinutes: shift.paidMinutes + shift.breakMinutes,
      })),
  });
}

/**
 * What every shift on the roster costs. Someone whose award has written-down rules is costed
 * by them across their whole week, because overtime depends on their other shifts; everyone
 * else is costed shift by shift from their rate and the day's loading.
 */
export function costRoster(
  shifts: CostedShift[],
  rates: RosterRates,
  rules: RosterRules,
  holidays: ReadonlySet<string>,
  weeks: number,
  /** Given when `shifts` are hours actually worked: each person's rostered minutes by day. */
  rosteredByUser?: Record<string, Record<string, number>>,
): Map<string, ShiftCosting> {
  const costs = new Map<string, ShiftCosting>();
  const people = new Set(shifts.flatMap((shift) => shift.userId ?? []));
  const awardPay = new Map<string, AwardPay>();
  for (const userId of people) {
    const pay = awardPayFor(
      userId,
      shifts,
      rates,
      holidays,
      weeks,
      rosteredByUser ? (rosteredByUser[userId] ?? {}) : undefined,
    );
    if (pay) awardPay.set(userId, pay);
  }
  for (const shift of shifts) {
    const pay = shift.userId ? awardPay.get(shift.userId) : undefined;
    if (pay) {
      costs.set(shift.id, {
        cents: pay.costByShift[shift.id] ?? 0,
        basis: 'award',
        lines: pay.lines.filter((line) => line.shiftId === shift.id),
        // A warning about the person's whole week is shown on each of their shifts.
        warnings: pay.warnings.filter(
          (warning) => warning.shiftId === shift.id || warning.shiftId === null,
        ),
      });
    } else {
      costs.set(shift.id, {
        cents: costOfShift(shift, rates, rules, holidays).cents,
        basis: 'rate',
        lines: [],
        warnings: [],
      });
    }
  }
  return costs;
}
