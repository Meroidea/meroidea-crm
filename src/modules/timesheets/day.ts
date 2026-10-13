/** Pairing what was rostered with what was recorded, for the daily approval screen. */

export type DayShift = {
  id: string;
  userId: string;
  teamId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  /** Unpaid break time. */
  breakMinutes: number;
  paidMinutes: number;
};

export type DayEntry = {
  id: string;
  userId: string;
  shiftId: string | null;
  date: string;
  startTime: string;
  /** Null while the person is still clocked in. */
  endTime: string | null;
  breakMinutes: number;
  workedMinutes: number;
  status: 'pending' | 'approved' | 'rejected';
  source: 'clock' | 'manual';
};

export type DayRow = {
  key: string;
  userId: string;
  shift: DayShift | null;
  entry: DayEntry | null;
};

const clock = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};

/** How far apart two start times are, in minutes. */
const gap = (shift: DayShift, entry: DayEntry) =>
  Math.abs(clock(shift.startTime) - clock(entry.startTime));

/**
 * One row per rostered shift and per stretch of recorded time on a day. Time recorded against a
 * shift stays with it; otherwise a person's time goes to their shift with the nearest start.
 * Time with no shift to go with is a row of its own, as is a shift nobody has time for yet.
 */
export function matchDay(shifts: DayShift[], entries: DayEntry[]): DayRow[] {
  const free = new Set(entries.map((entry) => entry.id));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const paired = new Map<string, DayEntry>();

  for (const entry of entries) {
    if (
      entry.shiftId &&
      shifts.some((shift) => shift.id === entry.shiftId && !paired.has(shift.id))
    ) {
      paired.set(entry.shiftId, entry);
      free.delete(entry.id);
    }
  }
  for (const shift of shifts) {
    if (paired.has(shift.id)) continue;
    const nearest = [...free]
      .flatMap((id) => byId.get(id) ?? [])
      .filter((entry) => entry.userId === shift.userId && !entry.shiftId)
      .sort((a, b) => gap(shift, a) - gap(shift, b))[0];
    if (nearest) {
      paired.set(shift.id, nearest);
      free.delete(nearest.id);
    }
  }

  return [
    ...shifts.map((shift) => ({
      key: `shift:${shift.id}`,
      userId: shift.userId,
      shift,
      entry: paired.get(shift.id) ?? null,
    })),
    ...entries
      .filter((entry) => free.has(entry.id))
      .map((entry) => ({ key: `entry:${entry.id}`, userId: entry.userId, shift: null, entry })),
  ];
}
