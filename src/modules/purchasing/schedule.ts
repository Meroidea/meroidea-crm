import { addDaysToDate } from '@/lib/dates';

export type OrderingRules = {
  /** Weekdays they deliver, 0 = Sunday … 6 = Saturday. Empty means any day. */
  deliveryDays: number[];
  leadDays: number;
  /** "HH:MM" on the ordering day, or null for any time. */
  cutoffTime: string | null;
};

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** The last day an order can be placed for delivery on `deliveryDate`. */
export const orderByDate = (rules: OrderingRules, deliveryDate: string) =>
  addDaysToDate(deliveryDate, -rules.leadDays);

/** Whether an order placed at `now` (workspace wall-clock) can still make `deliveryDate`. */
export function canDeliverOn(
  rules: OrderingRules,
  deliveryDate: string,
  now: { date: string; time: string },
): boolean {
  if (rules.deliveryDays.length > 0 && !rules.deliveryDays.includes(weekdayOf(deliveryDate))) {
    return false;
  }
  const orderBy = orderByDate(rules, deliveryDate);
  if (orderBy > now.date) return true;
  if (orderBy < now.date) return false;
  return !rules.cutoffTime || now.time <= rules.cutoffTime;
}

/** The next dates this supplier can deliver on, soonest first. */
export function nextDeliveryDates(
  rules: OrderingRules,
  now: { date: string; time: string },
  count = 8,
): { date: string; orderBy: string }[] {
  const dates: { date: string; orderBy: string }[] = [];
  for (let offset = 0; offset <= 120 && dates.length < count; offset += 1) {
    const date = addDaysToDate(now.date, offset);
    if (canDeliverOn(rules, date, now)) dates.push({ date, orderBy: orderByDate(rules, date) });
  }
  return dates;
}

/** "Mon, Wed and Fri", "Any day". */
export function describeDeliveryDays(days: number[]): string {
  if (days.length === 0 || days.length === 7) return 'Any day';
  const names = [...days].sort((a, b) => a - b).map((day) => (WEEKDAYS[day] ?? '').slice(0, 3));
  return names.length === 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
