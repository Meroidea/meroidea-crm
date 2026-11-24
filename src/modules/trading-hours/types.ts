/**
 * A business's trading hours (ADR-076): one entry per weekday, 0 = Sunday … 6 = Saturday.
 * `opensAt`/`closesAt` are wall-clock "HH:MM" in the business's timezone, both null when closed;
 * a close at or before the open runs past midnight. Pure, shared by server and forms.
 */
export type TradingDay = {
  weekday: number;
  opensAt: string | null;
  closesAt: string | null;
  staffNeeded: number;
};

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Monday first, as people read a week. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** What the form starts from when a business has set nothing: weekdays 9 to 5, one person. */
export function defaultTradingWeek(): TradingDay[] {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    opensAt: weekday === 0 || weekday === 6 ? null : '09:00',
    closesAt: weekday === 0 || weekday === 6 ? null : '17:00',
    staffNeeded: 1,
  }));
}

/** All seven days, filling any the business has not saved as closed. */
export function fullWeek(days: TradingDay[]): TradingDay[] {
  return [0, 1, 2, 3, 4, 5, 6].map(
    (weekday) =>
      days.find((day) => day.weekday === weekday) ?? {
        weekday,
        opensAt: null,
        closesAt: null,
        staffNeeded: 1,
      },
  );
}

export const isOpen = (day: TradingDay) => day.opensAt !== null && day.closesAt !== null;
