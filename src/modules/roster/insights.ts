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
