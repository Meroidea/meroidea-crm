import { matchDay, type DayEntry, type DayShift } from './day';

/**
 * The Timesheet view (ADR-083): one row per rostered shift or stretch of recorded time, and what
 * it says. Before the pay period is authorised a row shows the clock-in and clock-out, or that
 * nobody clocked in; once it is authorised, the authorised times. Pure, so it is tested directly.
 */

export type SheetStatus =
  /** The pay period is authorised and this time was part of it. */
  | 'authorised'
  /** A manager approved it; the pay period is not authorised yet. */
  | 'approved'
  /** Clocked in and out (or typed in), waiting to be approved. */
  | 'recorded'
  | 'clocked_in'
  | 'rejected'
  /** A shift that has finished with nothing recorded. */
  | 'no_clock'
  /** A shift that has not finished yet. */
  | 'upcoming'
  /** The period was authorised from approved time and this shift had none: it was not paid. */
  | 'not_paid';

export type SheetRow = {
  key: string;
  userId: string;
  date: string;
  team: string | null;
  rostered: { start: string; end: string } | null;
  /** The times on the time entry: clocked, typed, or authorised. */
  times: { start: string; end: string | null; breakMinutes: number; workedMinutes: number } | null;
  source: DayEntry['source'] | null;
  /** The time entry behind the row, for approving or correcting it. */
  entryId: string | null;
  note: string | null;
  status: SheetStatus;
};

const minutesOf = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};
const nextDay = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const finish = (shift: DayShift) =>
  `${minutesOf(shift.endTime) <= minutesOf(shift.startTime) ? nextDay(shift.date) : shift.date}T${shift.endTime}`;

export function sheetRows(input: {
  shifts: DayShift[];
  entries: DayEntry[];
  teamOf: (teamId: string | null) => string | null;
  noteOf?: (entryId: string) => string | null;
  /** The pay period has been authorised for pay. */
  locked: boolean;
  /** The business's local time now, "YYYY-MM-DDTHH:MM". */
  now: string;
}): SheetRow[] {
  const dates = [
    ...new Set([...input.shifts.map((shift) => shift.date), ...input.entries.map((e) => e.date)]),
  ].sort();
  return dates.flatMap((date) =>
    matchDay(
      input.shifts.filter((shift) => shift.date === date),
      input.entries.filter((entry) => entry.date === date),
    ).map((row): SheetRow => {
      const { shift, entry } = row;
      let status: SheetStatus;
      if (entry) {
        if (!entry.endTime) status = 'clocked_in';
        else if (entry.status === 'rejected') status = 'rejected';
        else if (entry.status === 'approved') status = input.locked ? 'authorised' : 'approved';
        else status = 'recorded';
      } else if (input.locked) {
        status = 'not_paid';
      } else {
        status = shift && finish(shift) <= input.now ? 'no_clock' : 'upcoming';
      }
      return {
        key: row.key,
        userId: row.userId,
        date,
        team: input.teamOf(shift?.teamId ?? null),
        rostered: shift ? { start: shift.startTime, end: shift.endTime } : null,
        times: entry
          ? {
              start: entry.startTime,
              end: entry.endTime,
              breakMinutes: entry.breakMinutes,
              workedMinutes: entry.workedMinutes,
            }
          : null,
        source: entry?.source ?? null,
        entryId: entry?.id ?? null,
        note: entry ? (input.noteOf?.(entry.id) ?? null) : null,
        status,
      };
    }),
  );
}
