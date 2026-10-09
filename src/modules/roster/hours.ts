/** "7.5h", "8h": hours to at most two decimals, without trailing zeros. */
export function formatHours(minutes: number): string {
  return `${Number((minutes / 60).toFixed(2))}h`;
}

const TAG_TONES = ['chart-1', 'chart-5', 'chart-3', 'chart-4', 'chart-2'] as const;

/** A stable colour token for a position tag, so the same tag is the same colour everywhere. */
export function positionTone(position: string | null): (typeof TAG_TONES)[number] {
  if (!position) return 'chart-3';
  let hash = 0;
  for (const char of position.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TAG_TONES[hash % TAG_TONES.length] ?? 'chart-3';
}

/** A two- or three-letter code for a tag: initials of its words, or its first letters. */
export function positionCode(position: string | null): string {
  const words = (position ?? '').trim().split(/\s+/).filter(Boolean);
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
