import { autoBreaks, shiftLength, unpaidMinutes, type BreakRule } from '@/modules/roster/rules';

/**
 * MeroAI's timesheet authorisation, planned in code (ADR-082). For every rostered shift and
 * every stretch of recorded time in the pay period, it decides the times to pay: the person's own
 * clock-in and clock-out when they recorded both, otherwise the rostered times; then the breaks
 * the business's rules give a shift that long. No model is involved, so the same timesheet always
 * gets the same answer, and every figure can be explained. Pure, so it is tested directly.
 */

export type AuthoriseSource = {
  key: string;
  userId: string;
  fullName: string;
  team: string | null;
  date: string;
  shift: { id: string; startTime: string; endTime: string } | null;
  entry: {
    id: string;
    startTime: string;
    /** Null while the person is still clocked in. */
    endTime: string | null;
    breakMinutes: number;
    status: 'pending' | 'approved' | 'rejected';
    source: 'clock' | 'manual';
  } | null;
  /** The viewer may approve this person's time (not their own, unless they are the Admin). */
  canApprove: boolean;
};

/** Where the times come from: the clock, time a manager typed, or the roster. */
export type AuthoriseBasis = 'clock' | 'typed' | 'roster';

export type AuthoriseRow = {
  key: string;
  userId: string;
  fullName: string;
  team: string | null;
  date: string;
  shiftId: string | null;
  entryId: string | null;
  rostered: { start: string; end: string } | null;
  recorded: { start: string; end: string | null } | null;
  basis: AuthoriseBasis;
  start: string;
  end: string;
  /** Unpaid break: comes off the time paid. */
  unpaidMinutes: number;
  /** Paid break: shown, and paid as time worked. */
  paidBreakMinutes: number;
  /** Time paid: the shift's length less its unpaid break. */
  workedMinutes: number;
  /**
   * `ready` goes into the authorisation; `approved` is already done and left alone; `skip` needs
   * a person (rejected time, someone's own time, or a shift still being worked).
   */
  status: 'ready' | 'approved' | 'skip';
  /** Things worth a look, in words, most important first. */
  notes: string[];
  canApprove: boolean;
};

/** Differences from the roster smaller than this are normal and not called out. */
const NOTICE_MINUTES = 5;
/** Longer than this and the shift is flagged for a second look. */
const LONG_SHIFT_MINUTES = 12 * 60;

const minutesOf = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};

const addDay = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** When a shift that starts on `date` ends, as a sortable "YYYY-MM-DDTHH:MM". */
const finishOf = (date: string, start: string, end: string) =>
  `${minutesOf(end) <= minutesOf(start) ? addDay(date) : date}T${end}`;

const describe = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h${rest ? ` ${rest}m` : ''}` : `${rest} min`;
};

/** The breaks a shift from `start` to `end` gets under the rules, split into unpaid and paid. */
export function breaksFor(start: string, end: string, rules: BreakRule[]) {
  const length = shiftLength(start, end);
  const breaks = autoBreaks(length, rules);
  const unpaid = unpaidMinutes(breaks);
  const paid = breaks.reduce((sum, item) => sum + (item.paid ? item.minutes : 0), 0);
  return { length, unpaid, paid, worked: Math.max(0, length - unpaid) };
}

/** How the times compare with the roster, when there is a roster to compare with. */
function againstRoster(
  rostered: { start: string; end: string },
  start: string,
  end: string,
): string[] {
  const notes: string[] = [];
  const startGap = minutesOf(start) - minutesOf(rostered.start);
  const endGap = minutesOf(end) - minutesOf(rostered.end);
  if (Math.abs(startGap) >= NOTICE_MINUTES) {
    notes.push(
      startGap > 0 ? `Started ${describe(startGap)} late` : `Started ${describe(-startGap)} early`,
    );
  }
  if (Math.abs(endGap) >= NOTICE_MINUTES) {
    notes.push(
      endGap > 0 ? `Finished ${describe(endGap)} late` : `Finished ${describe(-endGap)} early`,
    );
  }
  return notes;
}

/**
 * The authorisation MeroAI proposes for a pay period, one row per shift or stretch of time.
 * `now` is the business's current local time ("YYYY-MM-DDTHH:MM"): a shift only counts once it
 * has finished.
 */
export function planAuthorisation(
  sources: AuthoriseSource[],
  rules: BreakRule[],
  now: string,
): AuthoriseRow[] {
  const rows: AuthoriseRow[] = [];
  for (const source of sources) {
    const { shift, entry } = source;
    const rostered = shift ? { start: shift.startTime, end: shift.endTime } : null;
    const recorded = entry ? { start: entry.startTime, end: entry.endTime } : null;
    const base = {
      key: source.key,
      userId: source.userId,
      fullName: source.fullName,
      team: source.team,
      date: source.date,
      shiftId: shift?.id ?? null,
      entryId: entry?.id ?? null,
      rostered,
      recorded,
      canApprove: source.canApprove,
    };

    let basis: AuthoriseBasis;
    let start: string;
    let end: string;
    const notes: string[] = [];
    if (entry?.endTime) {
      basis = entry.source === 'clock' ? 'clock' : 'typed';
      start = entry.startTime;
      end = entry.endTime;
      if (rostered) notes.push(...againstRoster(rostered, start, end));
      else notes.push('Not rostered: worked without a shift');
    } else if (entry && shift) {
      // Clocked in but never out: the start is theirs, the finish the roster's.
      if (finishOf(source.date, shift.startTime, shift.endTime) > now) continue;
      basis = 'clock';
      start = entry.startTime;
      end = shift.endTime;
      notes.push('Still clocked in: the finish is taken from the roster');
      notes.push(...againstRoster({ start: shift.startTime, end: shift.endTime }, start, end));
    } else if (entry) {
      // Still clocked in with no shift to finish it: nothing to authorise yet.
      continue;
    } else if (shift) {
      if (finishOf(source.date, shift.startTime, shift.endTime) > now) continue;
      basis = 'roster';
      start = shift.startTime;
      end = shift.endTime;
      notes.push('No clock-in or clock-out: the rostered times are used');
    } else {
      continue;
    }

    const breaks = breaksFor(start, end, rules);
    // Only worth saying when the person recorded a break of their own that the rules replaced.
    if (entry?.endTime && entry.breakMinutes > 0 && entry.breakMinutes !== breaks.unpaid) {
      notes.push(`Break set by your rules (${entry.breakMinutes} min was recorded)`);
    }
    if (breaks.length > LONG_SHIFT_MINUTES) notes.push('Longer than 12 hours: check it');

    let status: AuthoriseRow['status'] = 'ready';
    if (entry?.status === 'approved') {
      status = 'approved';
      notes.unshift('Already approved: left as it is');
    } else if (entry?.status === 'rejected') {
      status = 'skip';
      notes.unshift('This time was rejected: check it by hand');
    } else if (!source.canApprove) {
      status = 'skip';
      notes.unshift('Your own time: someone else has to approve it');
    }

    rows.push({
      ...base,
      basis,
      start,
      end,
      unpaidMinutes: breaks.unpaid,
      paidBreakMinutes: breaks.paid,
      workedMinutes: breaks.worked,
      status,
      notes,
    });
  }
  return rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.start.localeCompare(b.start) ||
      a.fullName.localeCompare(b.fullName),
  );
}
