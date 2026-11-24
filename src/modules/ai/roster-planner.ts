import 'server-only';

import { addDaysToDate, daysBetweenDates } from '@/lib/dates';
import { formatCalendarDate } from '@/lib/format';
import { formatCents } from '@/modules/books/money';
import { listActiveMembers } from '@/modules/members/queries';
import { getProductivity } from '@/modules/productivity/queries';
import { costOfShift } from '@/modules/roster/insights';
import {
  getRosterForDate,
  getRosterRules,
  listRosterLeave,
  listRosterRates,
  listRosterShifts,
  listRosterTeams,
} from '@/modules/roster/queries';
import type { RosterRates } from '@/modules/roster/types';
import { getTradingHours } from '@/modules/trading-hours/queries';
import { hasFeature, hasPermission, type TenantContext } from '@/server/context';

import {
  productivityScore,
  requirementsCopyingWeek,
  requirementsFromTradingHours,
  requirementsFromWeek,
  solveRoster,
  type ShiftRequirement,
} from './roster-solver';
import type { RosterPreviewArtifact, RosterStrategy } from './types';

/**
 * Plans a roster with one of MeroAI's ways of working (ADR-076). Deterministic: the same week,
 * people and strategy give the same roster, instantly and without a model call. Every strategy
 * keeps the solver's rules (no one on leave, no double-booking, one shift a day, ordinary hours
 * capped); they differ in which shifts are needed and who is preferred for each:
 *
 * - copy_last_week: last week's shifts, offered first to last week's people;
 * - lowest_cost: the cheapest person for each shift, priced as the roster page prices it
 *   (hourly rate × the day's loading, award loadings included);
 * - most_productive: people with the best recent record first (productivityScore);
 * - even_hours: hours spread evenly.
 *
 * Which shifts are needed, for every strategy but copying: what the caller asked for, else the
 * trading hours, else last week's pattern.
 */

/** Ordinary hours: the National Employment Standards' 38 a week for full-time work. */
const ORDINARY_MINUTES_PER_WEEK = 38 * 60;
const PRODUCTIVITY_DAYS = 28;

export type PlanOutcome =
  | {
      kind: 'artifact';
      artifact: RosterPreviewArtifact;
      reply: string;
      audit: Record<string, unknown>;
    }
  | { kind: 'unavailable'; message: string };

/** Shifts on any roster covering part of the days from `from` to `to`, both inclusive. */
export async function shiftsBetween(ctx: TenantContext, from: string, to: string) {
  const days = daysBetweenDates(from, to) + 1;
  const rosterIds = new Set<string>();
  for (let index = 0; index < days; index += 1) {
    const roster = await getRosterForDate(ctx, addDaysToDate(from, index));
    if (roster) rosterIds.add(roster.id);
  }
  return (await Promise.all([...rosterIds].map((id) => listRosterShifts(ctx, id))))
    .flat()
    .filter((shift) => shift.date >= from && shift.date <= to);
}

const hasRates = (rates: RosterRates | null): rates is RosterRates =>
  rates !== null && Object.keys(rates).length > 0;

export type StrategyOption = {
  key: RosterStrategy;
  available: boolean;
  /** Why it cannot run, in words for the manager. */
  reason: string | null;
};

/** Which ways of working can run for a roster starting `startsOn`, and why not when not. */
export async function rosterStrategyOptions(
  ctx: TenantContext,
  startsOn: string,
): Promise<{ options: StrategyOption[]; tradingHoursSet: boolean }> {
  const [lastWeek, tradingDays, rates] = await Promise.all([
    shiftsBetween(ctx, addDaysToDate(startsOn, -7), addDaysToDate(startsOn, -1)),
    getTradingHours(ctx),
    listRosterRates(ctx),
  ]);
  const tradingHoursSet = tradingDays.some((day) => day.opensAt !== null);
  const needsShifts =
    tradingHoursSet || lastWeek.length > 0
      ? null
      : 'Set your trading hours in Settings → Workspace so MeroAI knows when you are open.';
  const option = (key: RosterStrategy, reason: string | null): StrategyOption => ({
    key,
    available: reason === null,
    reason,
  });
  return {
    tradingHoursSet,
    options: [
      option(
        'copy_last_week',
        lastWeek.length > 0 ? null : 'There is no roster for the week before.',
      ),
      option(
        'lowest_cost',
        needsShifts ??
          (rates === null
            ? 'Only someone who manages employee pay can roster by wage cost.'
            : hasRates(rates)
              ? null
              : 'Nobody has an hourly rate yet: add rates to staff contracts first.'),
      ),
      option(
        'most_productive',
        needsShifts ??
          (hasFeature(ctx, 'productivity') && hasPermission(ctx, 'productivity.view')
            ? null
            : 'Needs Productivity reports, which this business or your role does not have.'),
      ),
      option('even_hours', needsShifts),
    ],
  };
}

export async function planRoster(
  ctx: TenantContext,
  input: {
    startDate: string;
    endDate: string;
    strategy: RosterStrategy;
    /** Shifts the caller already worked out (the chat tool, from the person's own words). */
    requirements?: ShiftRequirement[];
    /** Only these people; everyone active when absent. */
    onlyUserIds?: string[];
    /** Days particular people cannot work, beyond their recorded leave. */
    unavailable?: { userId: string; date: string }[];
    extraWarnings?: string[];
  },
): Promise<PlanOutcome> {
  const days = daysBetweenDates(input.startDate, input.endDate) + 1;
  const dates = Array.from({ length: days }, (_, index) => addDaysToDate(input.startDate, index));
  const weekBefore = {
    from: addDaysToDate(input.startDate, -7),
    to: addDaysToDate(input.startDate, -1),
  };

  const [members, teams, leave, rules, existing, lastWeek, tradingDays, rates] = await Promise.all([
    listActiveMembers(ctx),
    listRosterTeams(ctx),
    listRosterLeave(ctx, input.startDate, input.endDate),
    getRosterRules(ctx),
    shiftsBetween(ctx, input.startDate, input.endDate),
    shiftsBetween(ctx, weekBefore.from, weekBefore.to),
    getTradingHours(ctx),
    listRosterRates(ctx),
  ]);

  // Which shifts are needed.
  let requirements: ShiftRequirement[];
  let source: NonNullable<RosterPreviewArtifact['source']>;
  if (input.strategy === 'copy_last_week') {
    if (lastWeek.length === 0)
      return { kind: 'unavailable', message: 'There is no roster for the week before to copy.' };
    requirements = requirementsCopyingWeek(lastWeek);
    source = 'last_week';
  } else if (input.requirements?.length) {
    requirements = input.requirements;
    source = 'request';
  } else if (tradingDays.some((day) => day.opensAt !== null)) {
    requirements = requirementsFromTradingHours(tradingDays);
    source = 'trading_hours';
  } else if (lastWeek.length > 0) {
    requirements = requirementsFromWeek(lastWeek);
    source = 'last_week';
  } else {
    return {
      kind: 'unavailable',
      message:
        'MeroAI does not know when you are open yet. Set your trading hours in Settings → Workspace.',
    };
  }

  // Who is preferred for each shift.
  const holidays = new Set(rules.holidays.map((holiday) => holiday.day));
  const warnings: string[] = [...(input.extraWarnings ?? [])];
  let rank: ((userId: string, date: string, paidMinutes: number) => number) | undefined;
  if (input.strategy === 'lowest_cost') {
    if (!hasRates(rates)) {
      return {
        kind: 'unavailable',
        message:
          'Rostering by wage cost needs staff hourly rates, which you cannot see or nobody has yet.',
      };
    }
    const unpriced = members.filter((member) => !rates[member.userId]).length;
    if (unpriced > 0) {
      warnings.push(
        `${unpriced} ${unpriced === 1 ? 'person has' : 'people have'} no hourly rate, so ${unpriced === 1 ? 'is' : 'are'} rostered only when nobody priced is free.`,
      );
    }
    rank = (userId, date, paidMinutes) =>
      costOfShift({ userId, date, paidMinutes }, rates, rules, holidays).cents ??
      Number.MAX_SAFE_INTEGER;
  } else if (input.strategy === 'most_productive') {
    if (!hasFeature(ctx, 'productivity') || !hasPermission(ctx, 'productivity.view')) {
      return {
        kind: 'unavailable',
        message: 'Rostering by productivity needs Productivity reports.',
      };
    }
    const rows = await getProductivity(ctx, {
      from: addDaysToDate(input.startDate, -PRODUCTIVITY_DAYS),
      to: addDaysToDate(input.startDate, -1),
    });
    const scores = new Map(rows.map((row) => [row.userId, productivityScore(row)]));
    const unknown = members.filter((member) => scores.get(member.userId) == null).length;
    if (unknown === members.length) {
      warnings.push(
        'Nobody has a record from the last four weeks yet, so hours are simply spread evenly.',
      );
    }
    // Higher scores first; a newcomer sits in the middle.
    rank = (userId) => -(scores.get(userId) ?? 0.5);
  }

  let people = members;
  if (input.onlyUserIds?.length) {
    const only = new Set(input.onlyUserIds);
    people = members.filter((member) => only.has(member.userId));
  }
  const busyDays = (input.unavailable ?? []).map((item) => ({
    userId: item.userId,
    startsOn: item.date,
    endsOn: item.date,
  }));

  const result = solveRoster({
    dates,
    requirements,
    people: people.map((person) => ({
      userId: person.userId,
      name: person.fullName,
      teamIds: teams
        .filter((team) => team.memberIds.includes(person.userId))
        .map((team) => team.id),
    })),
    leave: [...leave, ...busyDays],
    existing,
    breakRules: rules.breakRules,
    rank,
    maxMinutesPerPerson: ORDINARY_MINUTES_PER_WEEK * Math.ceil(days / 7),
  });

  const nameOf = new Map(members.map((member) => [member.userId, member.fullName]));
  const teamOf = new Map(teams.map((team) => [team.id, team.name]));
  let estimatedCost: RosterPreviewArtifact['estimatedCost'] = null;
  if (hasRates(rates)) {
    let cents = 0;
    let unpriced = 0;
    for (const shift of result.shifts) {
      const cost = shift.userId ? costOfShift(shift, rates, rules, holidays).cents : null;
      if (cost === null) unpriced += 1;
      else cents += cost;
    }
    estimatedCost = {
      total: formatCents(BigInt(Math.round(cents))),
      currency: ctx.tenant.currency,
      unpriced,
    };
  }
  if (source === 'last_week' && input.strategy !== 'copy_last_week') {
    warnings.unshift('Trading hours are not set, so shifts repeat the week before.');
  }
  if (existing.length > 0) {
    warnings.push(
      `${existing.length} shift${existing.length === 1 ? ' is' : 's are'} already rostered in this period and stay as ${existing.length === 1 ? 'it is' : 'they are'}.`,
    );
  }

  const artifact: RosterPreviewArtifact = {
    kind: 'roster_preview',
    strategy: input.strategy,
    source,
    startsOn: input.startDate,
    endsOn: input.endDate,
    shifts: result.shifts.map((shift) => ({
      ...shift,
      personName: shift.userId ? (nameOf.get(shift.userId) ?? null) : null,
      teamName: shift.teamId ? (teamOf.get(shift.teamId) ?? null) : null,
    })),
    people: result.load
      .filter((load) => load.newShifts > 0 || load.existingMinutes > 0)
      .map((load) => ({ ...load, name: nameOf.get(load.userId) ?? 'Unknown' })),
    unfilled: result.unfilled,
    estimatedCost,
    warnings: [...warnings, ...result.warnings],
  };
  const filled = result.shifts.length - result.unfilled;
  return {
    kind: 'artifact',
    artifact,
    reply: `Here is a roster for ${formatCalendarDate(input.startDate)} to ${formatCalendarDate(input.endDate)}: ${filled} of ${result.shifts.length} shifts filled${result.unfilled ? `, ${result.unfilled} left vacant` : ''}. Approving adds them as unpublished changes; staff see nothing until you publish the roster.`,
    audit: {
      strategy: input.strategy,
      source,
      startsOn: input.startDate,
      endsOn: input.endDate,
      shifts: result.shifts.length,
      unfilled: result.unfilled,
    },
  };
}
