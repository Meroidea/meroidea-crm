import { autoBreaks, shiftLength, unpaidMinutes, type BreakRule } from '@/modules/roster/rules';

/**
 * Fills a roster preview from shift requirements (ADR-074). Deterministic on purpose: the model
 * turns "two on the floor every weekday, 7 to 3" into requirements, and this code decides who
 * works when. A language model asked to assign people double-books them and forgets leave; this
 * never does, and gives the same answer for the same inputs. Pure, so it is tested directly.
 */

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type ShiftRequirement = {
  weekdays: Weekday[];
  startTime: string;
  endTime: string;
  staffNeeded: number;
  teamId: string | null;
  note: string | null;
};

export type SolverPerson = { userId: string; name: string; teamIds: string[] };

export type SolverInput = {
  /** Every calendar day of the period, in order. */
  dates: string[];
  requirements: ShiftRequirement[];
  people: SolverPerson[];
  /** Pending and approved time away; nobody is rostered onto either. */
  leave: { userId: string; startsOn: string; endsOn: string }[];
  /** Shifts already on a roster in the period, which count towards each person's hours. */
  existing: { userId: string | null; date: string; startTime: string; endTime: string }[];
  breakRules: BreakRule[];
};

export type PlannedShift = {
  date: string;
  startTime: string;
  endTime: string;
  /** Null when nobody could take it: saved as a vacant shift for the manager to fill. */
  userId: string | null;
  teamId: string | null;
  breaks: { minutes: number; paid: boolean }[];
  paidMinutes: number;
  note: string | null;
};

export type SolverResult = {
  shifts: PlannedShift[];
  /** Hours per person in the period, existing shifts included. */
  load: { userId: string; newShifts: number; newMinutes: number; existingMinutes: number }[];
  unfilled: number;
  warnings: string[];
};

const minutesOf = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};

export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? 'sun';
}

type Interval = { start: number; end: number };

export function solveRoster(input: SolverInput): SolverResult {
  const dayIndex = new Map(input.dates.map((date, index) => [date, index]));
  const interval = (date: string, startTime: string, endTime: string): Interval | null => {
    const day = dayIndex.get(date);
    if (day === undefined) return null;
    const start = day * 1440 + minutesOf(startTime);
    return { start, end: start + shiftLength(startTime, endTime) };
  };
  const paidOf = (startTime: string, endTime: string) => {
    const length = shiftLength(startTime, endTime);
    const breaks = autoBreaks(length, input.breakRules);
    return { breaks, paidMinutes: length - unpaidMinutes(breaks) };
  };

  const busy = new Map<string, Interval[]>();
  const worksOn = new Map<string, Set<string>>();
  const minutes = new Map<string, { existing: number; added: number; shifts: number }>();
  for (const person of input.people) {
    busy.set(person.userId, []);
    worksOn.set(person.userId, new Set());
    minutes.set(person.userId, { existing: 0, added: 0, shifts: 0 });
  }
  for (const shift of input.existing) {
    if (!shift.userId || !busy.has(shift.userId)) continue;
    const span = interval(shift.date, shift.startTime, shift.endTime);
    if (span) busy.get(shift.userId)!.push(span);
    worksOn.get(shift.userId)!.add(shift.date);
    minutes.get(shift.userId)!.existing += paidOf(shift.startTime, shift.endTime).paidMinutes;
  }
  const away = (userId: string, date: string) =>
    input.leave.some(
      (item) => item.userId === userId && item.startsOn <= date && item.endsOn >= date,
    );

  const shifts: PlannedShift[] = [];
  const shortBy = new Map<number, number>();

  const eligible = (date: string, requirement: ShiftRequirement, span: Interval) =>
    input.people.filter(
      (person) =>
        (!requirement.teamId || person.teamIds.includes(requirement.teamId)) &&
        !away(person.userId, date) &&
        // One shift a day each, and never two at once (an overnight shift reaches tomorrow).
        !worksOn.get(person.userId)!.has(date) &&
        !busy.get(person.userId)!.some((other) => other.start < span.end && other.end > span.start),
    );

  for (const date of input.dates) {
    const weekday = weekdayOf(date);
    const seats = input.requirements.flatMap((requirement, index) =>
      requirement.weekdays.includes(weekday)
        ? Array.from({ length: requirement.staffNeeded }, () => ({
            requirement,
            index,
            span: interval(date, requirement.startTime, requirement.endTime)!,
          }))
        : [],
    );

    // The seat fewest people can take is filled first, counted again after every choice: a
    // shift only one person can work (say, the one member of a team) is not left vacant because
    // that person was handed an earlier shift anyone could have taken.
    const open = [...seats];
    while (open.length > 0) {
      let best = 0;
      let bestCandidates = eligible(date, open[0]!.requirement, open[0]!.span);
      for (let at = 1; at < open.length; at += 1) {
        const candidates = eligible(date, open[at]!.requirement, open[at]!.span);
        const seat = open[at]!;
        const current = open[best]!;
        if (
          candidates.length < bestCandidates.length ||
          (candidates.length === bestCandidates.length && seat.span.start < current.span.start)
        ) {
          best = at;
          bestCandidates = candidates;
        }
      }
      const [{ requirement, index, span }] = open.splice(best, 1) as [(typeof open)[number]];
      const { breaks, paidMinutes } = paidOf(requirement.startTime, requirement.endTime);
      // Whoever has the fewest hours in the period so far, then the fewest shifts, then by name,
      // so the same request always gives the same roster.
      bestCandidates.sort((a, b) => {
        const left = minutes.get(a.userId)!;
        const right = minutes.get(b.userId)!;
        return (
          left.existing + left.added - (right.existing + right.added) ||
          left.shifts - right.shifts ||
          a.name.localeCompare(b.name)
        );
      });
      const chosen = bestCandidates[0];
      if (chosen) {
        busy.get(chosen.userId)!.push(span);
        worksOn.get(chosen.userId)!.add(date);
        const load = minutes.get(chosen.userId)!;
        load.added += paidMinutes;
        load.shifts += 1;
      } else {
        shortBy.set(index, (shortBy.get(index) ?? 0) + 1);
      }
      shifts.push({
        date,
        startTime: requirement.startTime,
        endTime: requirement.endTime,
        userId: chosen?.userId ?? null,
        teamId: requirement.teamId,
        breaks,
        paidMinutes,
        note: requirement.note,
      });
    }
  }
  // In the order a person reads a roster: by day, then by start time.
  const order = new Map(input.dates.map((date, position) => [date, position]));
  shifts.sort(
    (a, b) =>
      order.get(a.date)! - order.get(b.date)! || minutesOf(a.startTime) - minutesOf(b.startTime),
  );

  const warnings: string[] = [];
  for (const [index, count] of shortBy) {
    const requirement = input.requirements[index]!;
    warnings.push(
      `${count} shift${count === 1 ? '' : 's'} from ${requirement.startTime} to ${requirement.endTime} had nobody free and ${count === 1 ? 'is' : 'are'} left vacant.`,
    );
  }
  if (input.people.length === 0) warnings.push('Nobody was available to roster.');

  return {
    shifts,
    load: input.people.map((person) => {
      const load = minutes.get(person.userId)!;
      return {
        userId: person.userId,
        newShifts: load.shifts,
        newMinutes: load.added,
        existingMinutes: load.existing,
      };
    }),
    unfilled: [...shortBy.values()].reduce((sum, count) => sum + count, 0),
    warnings,
  };
}
