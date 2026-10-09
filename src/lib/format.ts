type Zoned = { tenant: { timezone: string } };

/** Stored in UTC, shown in the workspace's timezone (.claude/rules/coding-standards.md). */
export function formatDate(ctx: Zoned, value: Date | string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: ctx.tenant.timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function formatDateTime(ctx: Zoned, value: Date | string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: ctx.tenant.timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

/** A calendar date (date of birth) has no timezone: format it as written. */
export function formatCalendarDate(value: string | null | undefined): string {
  if (!value) return '—';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts.at(-1)?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

/**
 * Money arrives from Postgres as a decimal string; it is only turned into a number here, for
 * display. Never do arithmetic on the result (sums happen in SQL).
 */
export function formatMoney(
  amount: string | number | null | undefined,
  currency: string,
  options: { compact?: boolean } = {},
): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    maximumFractionDigits: options.compact || Number.isInteger(value) ? 0 : 2,
    ...(options.compact ? { notation: 'compact' } : {}),
  }).format(value);
}

export function formatRelative(value: Date | string | null | undefined, now = new Date()): string {
  if (!value) return '—';
  const diff = new Date(value).getTime() - now.getTime();
  const minutes = Math.round(diff / 60_000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return rtf.format(days, 'day');
  return rtf.format(Math.round(days / 30), 'month');
}
