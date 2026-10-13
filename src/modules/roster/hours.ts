/** "7.5h", "8h": hours to at most two decimals, without trailing zeros. */
export function formatHours(minutes: number): string {
  return `${Number((minutes / 60).toFixed(2))}h`;
}

/** A two- or three-letter code for a team: initials of its words, or its first letters. */
export function teamCode(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase();
  return words
    .slice(0, 3)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();
}

/** Weekday and day-of-month parts of a plain calendar date. */
export function dayParts(date: string): { weekday: string; day: string } {
  const value = new Date(`${date}T00:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', ...options }).format(value);
  return { weekday: part({ weekday: 'short' }), day: part({ day: 'numeric', month: 'short' }) };
}
