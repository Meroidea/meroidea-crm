/**
 * How the Email area's list groups and dates its threads (ADR-087): by the business's own
 * calendar day, so a thread at 11 pm in Sydney is "Today" in Sydney whatever the server's zone.
 */

export const DAY_GROUPS = ['today', 'yesterday', 'week', 'month', 'older'] as const;
export type DayGroup = (typeof DAY_GROUPS)[number];

export const DAY_GROUP_LABELS: Record<DayGroup, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Last 7 days',
  month: 'Last 30 days',
  older: 'Older',
};

/** The calendar day a moment falls on in a timezone, as a count of days since 1970. */
function dayNumber(value: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Math.round(Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000);
}

/** Whole calendar days between a moment and now, in the business's timezone. */
function daysAgo(value: Date, timeZone: string, now: Date): number {
  return dayNumber(now, timeZone) - dayNumber(value, timeZone);
}

export function dayGroup(value: Date | null, timeZone: string, now = new Date()): DayGroup {
  if (!value) return 'older';
  const days = daysAgo(value, timeZone, now);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'week';
  if (days < 30) return 'month';
  return 'older';
}

/**
 * The time beside a thread in the list: the time today, the weekday this week, the date this
 * year, and the full date before that.
 */
export function listTime(value: Date | null, timeZone: string, now = new Date()): string {
  if (!value) return '';
  const days = daysAgo(value, timeZone, now);
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-AU', { timeZone, ...options }).format(value);
  if (days <= 0) return format({ hour: 'numeric', minute: '2-digit' });
  if (days < 7) return format({ weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const sameYear =
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(value) ===
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(now);
  return sameYear
    ? format({ day: 'numeric', month: 'short' })
    : format({ day: 'numeric', month: 'short', year: 'numeric' });
}

/** Rows in the order given, cut into day groups; empty groups are left out. */
export function groupByDay<T>(
  rows: readonly T[],
  at: (row: T) => Date | null,
  timeZone: string,
  now = new Date(),
): { group: DayGroup; rows: T[] }[] {
  const groups: { group: DayGroup; rows: T[] }[] = [];
  for (const row of rows) {
    const group = dayGroup(at(row), timeZone, now);
    const last = groups.at(-1);
    if (last && last.group === group) last.rows.push(row);
    else groups.push({ group, rows: [row] });
  }
  return groups;
}
