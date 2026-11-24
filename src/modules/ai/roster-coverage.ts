import { shiftLength } from '@/modules/roster/rules';

/**
 * How well a roster covers the hours the business trades, measured against the staff count it
 * set for each day (ADR-076, ADR-079). Pure, so the roster page, the roster agent and Instant
 * build all measure it the same way.
 */

export type TradingDay = {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  opensAt: string | null;
  closesAt: string | null;
  staffNeeded: number;
};

export type CoverageShift = {
  date: string;
  startTime: string;
  endTime: string;
  userId: string | null;
};

/** A stretch of a day with fewer people on than the business needs. */
export type CoverageGap = { date: string; from: string; to: string; short: number };

const STEP = 15;

const minutesOf = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};

const clock = (minutes: number) => {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
};

const weekdayNumber = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

function tradingFor(days: TradingDay[], date: string) {
  const day = days.find((item) => item.weekday === weekdayNumber(date));
  if (!day?.opensAt || !day.closesAt) return null;
  return {
    opens: minutesOf(day.opensAt),
    length: shiftLength(day.opensAt.slice(0, 5), day.closesAt.slice(0, 5)),
    staffNeeded: day.staffNeeded,
  };
}

/** Person-hours each day needs, in minutes: open hours × the day's staff count. */
export function demandByDate(days: TradingDay[], dates: string[]): Record<string, number> {
  const demand: Record<string, number> = {};
  for (const date of dates) {
    const trading = tradingFor(days, date);
    demand[date] = trading ? trading.length * trading.staffNeeded : 0;
  }
  return demand;
}

/**
 * Where fewer people are rostered than the day's staff count, in quarter hours, joined into
 * stretches. Only shifts with someone on them count: a vacant shift covers nobody. A shift that
 * runs past midnight covers the next morning too.
 */
export function coverageGaps(
  days: TradingDay[],
  dates: string[],
  shifts: CoverageShift[],
): CoverageGap[] {
  const index = new Map(dates.map((date, position) => [date, position]));
  const spans = shifts.flatMap((shift) => {
    const day = index.get(shift.date);
    if (day === undefined || !shift.userId) return [];
    const start = day * 1440 + minutesOf(shift.startTime);
    return [{ start, end: start + shiftLength(shift.startTime, shift.endTime) }];
  });

  const gaps: CoverageGap[] = [];
  dates.forEach((date, day) => {
    const trading = tradingFor(days, date);
    if (!trading) return;
    let open: CoverageGap | null = null;
    for (let at = 0; at < trading.length; at += STEP) {
      const from = day * 1440 + trading.opens + at;
      const to = Math.min(from + STEP, day * 1440 + trading.opens + trading.length);
      const on = spans.filter((span) => span.start <= from && span.end >= to).length;
      const short = Math.max(0, trading.staffNeeded - on);
      if (short > 0 && open && open.short === short) {
        open.to = clock(to);
      } else {
        if (open) gaps.push(open);
        open = short > 0 ? { date, from: clock(from), to: clock(to), short } : null;
      }
    }
    if (open) gaps.push(open);
  });
  return gaps;
}
