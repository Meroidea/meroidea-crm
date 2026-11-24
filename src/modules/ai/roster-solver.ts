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
  /** Who should have each seat if they still can (by seat), e.g. last week's people. */
  preferred?: (string | null)[];
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
  /**
   * How suitable a person is for a shift, lower first (a wage cost, or a negated productivity
   * score). Ties, and everything without a rank, fall back to whoever has the fewest hours.
   */
  rank?: (userId: string, date: string, paidMinutes: number) => number;
  /** The most paid minutes anyone may have in the period, existing shifts included. */
  maxMinutesPerPerson?: number;
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
  const cappedBy = new Map<number, number>();
  const withinCap = (userId: string, paidMinutes: number) => {
    if (input.maxMinutesPerPerson === undefined) return true;
    const load = minutes.get(userId)!;
    return load.existing + load.added + paidMinutes <= input.maxMinutesPerPerson;
  };

  const eligible = (date: string, requirement: ShiftRequirement, span: Interval) =>
    input.people.filter(
      (person) =>
        (!requirement.teamId || person.teamIds.includes(requirement.teamId)) &&
        withinCap(person.userId, paidOf(requirement.startTime, requirement.endTime).paidMinutes) &&
        !away(person.userId, date) &&
        // One shift a day each, and never two at once (an overnight shift reaches tomorrow).
        !worksOn.get(person.userId)!.has(date) &&
        !busy.get(person.userId)!.some((other) => other.start < span.end && other.end > span.start),
    );

  for (const date of input.dates) {
    const weekday = weekdayOf(date);
    const seats = input.requirements.flatMap((requirement, index) =>
      requirement.weekdays.includes(weekday)
        ? Array.from({ length: requirement.staffNeeded }, (_, seat) => ({
            requirement,
            index,
            preferred: requirement.preferred?.[seat] ?? null,
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
      const [{ requirement, index, span, preferred }] = open.splice(best, 1) as [
        (typeof open)[number],
      ];
      const { breaks, paidMinutes } = paidOf(requirement.startTime, requirement.endTime);
      // The seat's preferred person when they can still take it; otherwise the best rank, then
      // whoever has the fewest hours so far, the fewest shifts, and by name, so the same request
      // always gives the same roster.
      const rankOf = (userId: string) => input.rank?.(userId, date, paidMinutes) ?? 0;
      bestCandidates.sort((a, b) => {
        const left = minutes.get(a.userId)!;
        const right = minutes.get(b.userId)!;
        return (
          rankOf(a.userId) - rankOf(b.userId) ||
          left.existing + left.added - (right.existing + right.added) ||
          left.shifts - right.shifts ||
          a.name.localeCompare(b.name)
        );
      });
      const chosen =
        (preferred && bestCandidates.find((person) => person.userId === preferred)) ||
        bestCandidates[0];
      if (chosen) {
        busy.get(chosen.userId)!.push(span);
        worksOn.get(chosen.userId)!.add(date);
        const load = minutes.get(chosen.userId)!;
        load.added += paidMinutes;
        load.shifts += 1;
      } else {
        shortBy.set(index, (shortBy.get(index) ?? 0) + 1);
        // Say why: someone was free but had reached their ordinary hours, or nobody was free.
        const capped =
          input.maxMinutesPerPerson !== undefined &&
          input.people.some(
            (person) =>
              (!requirement.teamId || person.teamIds.includes(requirement.teamId)) &&
              !away(person.userId, date) &&
              !worksOn.get(person.userId)!.has(date) &&
              !busy
                .get(person.userId)!
                .some((other) => other.start < span.end && other.end > span.start),
          );
        if (capped) cappedBy.set(index, (cappedBy.get(index) ?? 0) + 1);
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
    const capped = cappedBy.get(index) ?? 0;
    const hours = Math.round((input.maxMinutesPerPerson ?? 0) / 60);
    warnings.push(
      capped === count
        ? `${count} shift${count === 1 ? '' : 's'} from ${requirement.startTime} to ${requirement.endTime} ${count === 1 ? 'is' : 'are'} left vacant: everyone free has reached ${hours} hours, so you may need more staff.`
        : `${count} shift${count === 1 ? '' : 's'} from ${requirement.startTime} to ${requirement.endTime} had nobody free and ${count === 1 ? 'is' : 'are'} left vacant.`,
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

/**
 * Shift requirements that repeat a week already rostered, for "build next week's roster" with no
 * times given: each weekday gets the same shifts, at the same times, in the same teams, with as
 * many people as that day had (vacant shifts included). Weekdays with the same shift share one
 * requirement.
 */
export function requirementsFromWeek(
  shifts: { date: string; startTime: string; endTime: string; teamId: string | null }[],
): ShiftRequirement[] {
  const perDay = new Map<string, number>();
  for (const shift of shifts) {
    const key = `${weekdayOf(shift.date)}|${shift.startTime}|${shift.endTime}|${shift.teamId ?? ''}`;
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  const grouped = new Map<string, ShiftRequirement>();
  for (const [key, count] of perDay) {
    const [weekday, startTime, endTime, teamId] = key.split('|') as [
      Weekday,
      string,
      string,
      string,
    ];
    const group = `${startTime}|${endTime}|${teamId}|${count}`;
    const requirement = grouped.get(group) ?? {
      weekdays: [],
      startTime,
      endTime,
      staffNeeded: count,
      teamId: teamId || null,
      note: null,
    };
    requirement.weekdays.push(weekday);
    grouped.set(group, requirement);
  }
  const order = (day: Weekday) => (WEEKDAYS.indexOf(day) + 6) % 7; // Monday first
  return [...grouped.values()]
    .map((requirement) => ({
      ...requirement,
      weekdays: [...requirement.weekdays].sort((a, b) => order(a) - order(b)),
    }))
    .sort(
      (a, b) =>
        a.startTime.localeCompare(b.startTime) || order(a.weekdays[0]!) - order(b.weekdays[0]!),
    );
}

/**
 * Last week's shifts as requirements that remember who had each one, for "copy last week": the
 * same shifts, offered first to the same people. Unlike requirementsFromWeek, weekdays are never
 * merged, because each day had its own people.
 */
export function requirementsCopyingWeek(
  shifts: {
    date: string;
    startTime: string;
    endTime: string;
    teamId: string | null;
    userId: string | null;
  }[],
): ShiftRequirement[] {
  const byKey = new Map<string, ShiftRequirement>();
  for (const shift of shifts) {
    const weekday = weekdayOf(shift.date);
    const key = `${weekday}|${shift.startTime}|${shift.endTime}|${shift.teamId ?? ''}`;
    const requirement = byKey.get(key) ?? {
      weekdays: [weekday],
      startTime: shift.startTime,
      endTime: shift.endTime,
      staffNeeded: 0,
      teamId: shift.teamId,
      note: null,
      preferred: [],
    };
    requirement.staffNeeded += 1;
    requirement.preferred!.push(shift.userId);
    byKey.set(key, requirement);
  }
  return [...byKey.values()];
}

const asClock = (minutes: number) => {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
};

/**
 * Shifts that cover the trading hours (ADR-076): each open day from opening to closing, split
 * into back-to-back shifts of at most `maxShiftMinutes` (on quarter hours), each needing the
 * day's staff count. Days with the same shifts share one requirement.
 */
export function requirementsFromTradingHours(
  days: { weekday: number; opensAt: string | null; closesAt: string | null; staffNeeded: number }[],
  maxShiftMinutes = 480,
): ShiftRequirement[] {
  const grouped = new Map<string, ShiftRequirement>();
  for (const day of days) {
    if (!day.opensAt || !day.closesAt) continue;
    const weekday = WEEKDAYS[day.weekday];
    if (!weekday) continue;
    const length = shiftLength(day.opensAt, day.closesAt);
    const count = Math.max(1, Math.ceil(length / maxShiftMinutes));
    const opens = minutesOf(day.opensAt);
    for (let part = 0; part < count; part += 1) {
      // Quarter-hour boundaries; the last shift always ends at closing.
      const start = opens + Math.round((length * part) / count / 15) * 15;
      const end =
        part === count - 1
          ? opens + length
          : opens + Math.round((length * (part + 1)) / count / 15) * 15;
      const key = `${asClock(start)}|${asClock(end)}|${day.staffNeeded}`;
      const requirement = grouped.get(key) ?? {
        weekdays: [],
        startTime: asClock(start),
        endTime: asClock(end),
        staffNeeded: day.staffNeeded,
        teamId: null,
        note: null,
      };
      requirement.weekdays.push(weekday);
      grouped.set(key, requirement);
    }
  }
  return [...grouped.values()];
}

/**
 * A person's record over recent weeks, 0 to 1: how much of their rostered time they actually
 * worked, and how many of their tasks with a due date they finished on time, averaged over what
 * is known. Null when nothing is known, so a newcomer is neither favoured nor punished.
 */
export function productivityScore(row: {
  rosteredMinutes: number | null;
  clockedMinutes: number | null;
  tasksOnTime: number | null;
  tasksWithDueDate: number | null;
}): number | null {
  const parts: number[] = [];
  if (row.rosteredMinutes && row.clockedMinutes !== null) {
    parts.push(Math.min(1, row.clockedMinutes / row.rosteredMinutes));
  }
  if (row.tasksWithDueDate && row.tasksOnTime !== null) {
    parts.push(row.tasksOnTime / row.tasksWithDueDate);
  }
  return parts.length ? parts.reduce((sum, part) => sum + part, 0) / parts.length : null;
}
