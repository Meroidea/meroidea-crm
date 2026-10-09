/** Wall-clock parts of `date` as seen in `timeZone`. */
function zonedParts(timeZone: string, date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function offsetMs(timeZone: string, date: Date): number {
  const p = zonedParts(timeZone, date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The instant a calendar day starts in the workspace's timezone ("today" for My Day is the
 * tenant's today, not the server's). `addDays` moves whole days from today.
 */
export function startOfZonedDay(timeZone: string, addDays = 0, now = new Date()): Date {
  const p = zonedParts(timeZone, now);
  const guess = Date.UTC(p.year, p.month - 1, p.day + addDays);
  return new Date(guess - offsetMs(timeZone, new Date(guess)));
}

/** A date input value ("2026-10-03") at local midnight in the workspace timezone. */
export function zonedDateToInstant(timeZone: string, value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  const guess = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 9);
  return new Date(guess - offsetMs(timeZone, new Date(guess)));
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/** The instant the current calendar month starts in the workspace timezone. */
export function startOfZonedMonth(timeZone: string, now = new Date()): Date {
  const p = zonedParts(timeZone, now);
  return startOfZonedDay(timeZone, 1 - p.day, now);
}

/** Today's calendar date ("2026-10-08") in the workspace timezone. */
export function zonedToday(timeZone: string, now = new Date()): string {
  return instantToZoned(timeZone, now).date;
}

/** A wall-clock date and time ("2026-10-08", "09:30") in the workspace timezone, as an instant. */
export function zonedDateTimeToInstant(timeZone: string, date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);
  // Two passes: the offset at the first guess can be an hour out on a daylight-saving changeover.
  const first = wall - offsetMs(timeZone, new Date(wall));
  return new Date(wall - offsetMs(timeZone, new Date(first)));
}

/** The calendar date and wall-clock time of an instant, as seen in the workspace timezone. */
export function instantToZoned(timeZone: string, instant: Date): { date: string; time: string } {
  const p = zonedParts(timeZone, instant);
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  return {
    date: `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

/** Calendar arithmetic on a plain date string; no timezone is involved. */
export function addDaysToDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days))
    .toISOString()
    .slice(0, 10);
}

/** Whole days from one plain date to another. */
export function daysBetweenDates(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The Monday on or before a plain date. */
export function mondayOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDaysToDate(date, -((weekday + 6) % 7));
}
