import type { AwardRateGroup, AwardRateSchedule } from '@/modules/hiring/award-rates';

import type {
  AwardInterpreter,
  AwardPay,
  AwardPayInput,
  AwardPayKind,
  AwardPayLine,
  AwardShift,
  AwardWarning,
} from './types';

/**
 * Restaurant Industry Award 2020 (MA000119), from the Fair Work Commission's consolidated text
 * incorporating all amendments up to and including 1 July 2026.
 *
 * This file holds the award's RULES: when a rate applies. It holds no rates. Every dollar
 * figure comes from the Commission's pay database through the person's rate schedule, and a
 * rate that is not published there stops the calculation rather than being worked out here.
 */

const HOUR = 60;
const DAY = 24 * HOUR;

/** cl 15.1(b), 10.13(b)(ii): most ordinary hours in a day for a full-time or part-time employee. */
const PERMANENT_DAILY_MAX = 11.5 * HOUR;
/** cl 11.2(a): most hours per day or per shift for a casual before overtime (cl 11.5). */
const CASUAL_DAILY_MAX = 12 * HOUR;
/** cl 9, 10.13(b)(i), 11.2(b): 38 hours a week, averaged over the roster cycle. */
const WEEKLY_ORDINARY = 38 * HOUR;
/** cl 23.4 Table 7: the first rate applies to the first 2 hours of overtime on a day. */
const OVERTIME_FIRST_BAND = 2 * HOUR;
/** cl 11.3: a casual is paid for at least 2 consecutive hours each time they attend. */
const CASUAL_MINIMUM = 2 * HOUR;
/** cl 24.4(a), (b): minimum payment for work on a public holiday. */
const HOLIDAY_MINIMUM = { permanent: 4 * HOUR, casual: 2 * HOUR };
/** cl 10.7(b): a part-timer is not rostered for fewer than 3 hours in a day. */
const PART_TIME_DAILY_MIN = 3 * HOUR;
/** cl 15.1(a): fewest ordinary hours for a full-timer on a day they work. */
const FULL_TIME_DAILY_MIN = 6 * HOUR;
/** cl 16.2 Table 2: 5 hours or more earns an unpaid meal break of at least 30 minutes. */
const MEAL_BREAK_FROM = 5 * HOUR;
const MEAL_BREAK_MINUTES = 30;
/** cl 13.3: nobody under 18 works more than 10 hours in a shift. */
const UNDER_18_SHIFT_MAX = 10 * HOUR;
/** cl 15.1(e): hours between finishing one day and starting the next, other than for casuals. */
const BREAK_BETWEEN_SHIFTS = 10 * HOUR;
/** cl 15.1(g): longest spread of a broken working day. */
const SPLIT_SHIFT_SPREAD = 12 * HOUR;
/** cl 21.3(b): a separate work period this long earns the split shift allowance. */
const SPLIT_PERIOD_MIN = 2 * HOUR;
/** cl 24.2 Table 8: the Monday to Friday windows that carry an extra amount per hour. */
const EVENING = { from: 22 * HOUR, to: DAY };
const NIGHT = { from: 0, to: 6 * HOUR };

const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
const dateOf = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
/** 0 is Sunday. */
const weekdayOf = (day: number) => new Date(day * 86_400_000).getUTCDay();
const clock = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return (hour ?? 0) * HOUR + (minute ?? 0);
};
const toCents = (amount: string) => {
  const [whole = '0', fraction = ''] = amount.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
};
const hours = (minutes: number) => `${Number((minutes / HOUR).toFixed(2))}h`;

type Rates = {
  ordinary: string;
  saturday: string;
  sunday: string;
  publicHoliday: string;
  overtimeWeekdayFirst: string;
  overtimeWeekdayAfter: string;
  overtimeSaturdayFirst: string;
  overtimeSaturdayAfter: string;
  overtimeSunday: string;
  evening: string | null;
  night: string | null;
  splitShift: string | null;
};

const lineIn = (group: AwardRateGroup | undefined, pattern: RegExp): string | null => {
  const found = group?.lines.filter((line) => pattern.test(line.description.trim())) ?? [];
  return found.length === 1 ? (found[0]?.hourly ?? null) : null;
};

/**
 * Finds each rate the rules need in the Commission's rows, by the wording the Commission uses
 * for this award. Returns the names of any that are missing instead of filling them in.
 */
export function readRates(schedule: AwardRateSchedule): Rates | { missing: string[] } {
  const ordinaryGroup = schedule.groups.find((group) =>
    /ordinary and penalty rates/i.test(group.title),
  );
  const overtimeGroup = schedule.groups.find((group) => /overtime rates/i.test(group.title));
  const allowance = (pattern: RegExp) =>
    schedule.allowances.find((item) => pattern.test(item.name))?.amount ?? null;
  const found = {
    ordinary: lineIn(ordinaryGroup, /^ordinary hours$/i),
    saturday: lineIn(ordinaryGroup, /^saturday$/i),
    sunday: lineIn(ordinaryGroup, /^sunday(\s[-–—]\s.*)?$/i),
    publicHoliday: lineIn(ordinaryGroup, /^public holiday$/i),
    overtimeWeekdayFirst: lineIn(overtimeGroup, /^monday to friday\s[-–—]\sfirst 2 hours$/i),
    overtimeWeekdayAfter: lineIn(overtimeGroup, /^monday to friday\s[-–—]\safter 2 hours$/i),
    overtimeSaturdayFirst: lineIn(overtimeGroup, /^saturday\s[-–—]\sfirst 2 hours$/i),
    overtimeSaturdayAfter: lineIn(overtimeGroup, /^saturday\s[-–—]\safter 2 hours$/i),
    overtimeSunday: lineIn(overtimeGroup, /^sunday\s[-–—]\sall time worked$/i),
  };
  const missing = Object.entries(found).flatMap(([name, value]) => (value === null ? [name] : []));
  if (missing.length > 0) return { missing };
  return {
    ...(found as Record<keyof typeof found, string>),
    evening: allowance(/^penalty.*10\.00 pm to midnight/i),
    night: allowance(/^penalty.*midnight to 6\.00 am/i),
    splitShift: allowance(/^split shift allowance/i),
  };
}

type Piece = {
  shift: AwardShift;
  /** Wall-clock minutes since the epoch day. */
  from: number;
  to: number;
};

/** The time actually worked in a shift: its span, less the unpaid break, taken mid-shift. */
function workedPieces(shift: AwardShift): { start: number; end: number; pieces: Piece[] } {
  const start = dayNumber(shift.date) * DAY + clock(shift.startTime);
  const length = clock(shift.endTime) - clock(shift.startTime);
  const end = start + (length <= 0 ? length + DAY : length);
  const unpaid = Math.max(0, Math.min(shift.unpaidBreakMinutes, end - start));
  if (unpaid === 0) return { start, end, pieces: [{ shift, from: start, to: end }] };
  // The award leaves the time of the break to the roster; without one, assume the middle.
  const breakFrom = Math.round((start + end - unpaid) / 2);
  return {
    start,
    end,
    pieces: [
      { shift, from: start, to: breakFrom },
      { shift, from: breakFrom + unpaid, to: end },
    ].filter((piece) => piece.to > piece.from),
  };
}

/** Cuts a piece wherever the rate can change: midnight, 6 am and 10 pm. */
function atBoundaries(piece: Piece): Piece[] {
  const cuts: Piece[] = [];
  let from = piece.from;
  while (from < piece.to) {
    const dayStart = Math.floor(from / DAY) * DAY;
    const next = [dayStart + NIGHT.to, dayStart + EVENING.from, dayStart + DAY].find(
      (edge) => edge > from,
    );
    const to = Math.min(piece.to, next ?? piece.to);
    cuts.push({ ...piece, from, to });
    from = to;
  }
  return cuts;
}

function pay(input: AwardPayInput): AwardPay {
  const { employment, schedule, shifts } = input;
  const casual = employment === 'casual';
  const warnings: AwardWarning[] = [];
  const lines: AwardPayLine[] = [];
  const empty = (): AwardPay => ({
    lines,
    minimumCents: 0,
    costCents: 0,
    costByShift: {},
    warnings,
  });

  const rates = readRates(schedule);
  if ('missing' in rates) {
    warnings.push({
      shiftId: null,
      clause: 'Pay database',
      message: `The pay database does not list every rate this award needs for this classification (${rates.missing.join(', ')}), so pay under the award was not worked out.`,
    });
    return empty();
  }

  // Minutes are grouped as they are found, so each shift gets one line per rate.
  const tally = new Map<string, AwardPayLine>();
  const add = (
    shift: AwardShift,
    kind: AwardPayKind,
    label: string,
    minutes: number,
    rate: string,
    clause: string,
  ) => {
    if (minutes <= 0) return;
    const key = `${shift.id}|${kind}|${label}`;
    const line = tally.get(key) ?? {
      shiftId: shift.id,
      kind,
      label,
      minutes: 0,
      rate,
      cents: 0,
      costCents: 0,
      clause,
    };
    line.minutes = (line.minutes ?? 0) + minutes;
    tally.set(key, line);
  };

  const ordered = [...shifts].sort(
    (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime),
  );
  const worked = ordered.map((shift) => ({ shift, ...workedPieces(shift) }));
  const dailyMax = casual ? CASUAL_DAILY_MAX : PERMANENT_DAILY_MAX;
  // cl 10.13(b)(iii): a part-timer is paid overtime for time worked beyond their rostered hours.
  const rostered = employment === 'part_time' ? input.rosteredMinutesByDate : undefined;
  const dayLimit = (date: string) =>
    rostered ? Math.min(dailyMax, rostered[date] ?? 0) : dailyMax;
  const weeklyMax = WEEKLY_ORDINARY * Math.max(1, input.weeks);
  const dayOrdinary = new Map<string, number>();
  const dayOvertime = new Map<string, number>();
  let cycleOrdinary = 0;
  /** Hours or part hours in each late window, per shift (cl 24.2: "per hour or part of an hour"). */
  const lateMinutes = new Map<string, { evening: number; night: number }>();
  const holidayMinutes = new Map<string, number>();
  const workedMinutes = new Map<string, number>();

  for (const { shift, pieces } of worked) {
    for (const cut of pieces.flatMap(atBoundaries)) {
      let from = cut.from;
      while (from < cut.to) {
        const day = Math.floor(from / DAY);
        const weekday = weekdayOf(day);
        const holiday = input.publicHolidays.has(dateOf(day));
        const usedToday = dayOrdinary.get(shift.date) ?? 0;
        const overToday = dayOvertime.get(shift.date) ?? 0;
        const room = Math.min(dayLimit(shift.date) - usedToday, weeklyMax - cycleOrdinary);
        const isOvertime = room <= 0;
        // Overtime moves from the first band to the second after two hours on that day (cl 23.3).
        const bandLeft =
          isOvertime && overToday < OVERTIME_FIRST_BAND
            ? OVERTIME_FIRST_BAND - overToday
            : Infinity;
        const span = Math.min(cut.to - from, isOvertime ? bandLeft : room);
        workedMinutes.set(shift.id, (workedMinutes.get(shift.id) ?? 0) + span);

        if (holiday) {
          // cl 24.2 Table 8. Table 7 has no public holiday row and its note sends public holiday
          // work to clause 24, so every hour worked on the day is paid at the public holiday rate.
          add(shift, 'publicHoliday', 'Public holiday', span, rates.publicHoliday, '24.2');
          holidayMinutes.set(shift.id, (holidayMinutes.get(shift.id) ?? 0) + span);
        } else if (isOvertime) {
          const first = overToday < OVERTIME_FIRST_BAND;
          const [label, rate] =
            weekday === 0
              ? ['Overtime, Sunday', rates.overtimeSunday]
              : weekday === 6
                ? first
                  ? ['Overtime, Saturday, first 2 hours', rates.overtimeSaturdayFirst]
                  : ['Overtime, Saturday, after 2 hours', rates.overtimeSaturdayAfter]
                : first
                  ? ['Overtime, Monday to Friday, first 2 hours', rates.overtimeWeekdayFirst]
                  : ['Overtime, Monday to Friday, after 2 hours', rates.overtimeWeekdayAfter];
          add(shift, 'overtime', label as string, span, rate as string, '23.4');
        } else if (weekday === 6) {
          add(shift, 'saturday', 'Saturday', span, rates.saturday, '24.2');
        } else if (weekday === 0) {
          add(shift, 'sunday', 'Sunday', span, rates.sunday, '24.2');
        } else {
          add(shift, 'ordinary', 'Ordinary hours', span, rates.ordinary, casual ? '11.1' : '18');
          // cl 24.1, 24.2: the extra amount is for ordinary hours, Monday to Friday only.
          const minuteOfDay = from - day * DAY;
          const late = lateMinutes.get(shift.id) ?? { evening: 0, night: 0 };
          if (minuteOfDay >= EVENING.from) late.evening += span;
          else if (minuteOfDay < NIGHT.to) late.night += span;
          lateMinutes.set(shift.id, late);
        }

        if (isOvertime) dayOvertime.set(shift.date, overToday + span);
        if (!isOvertime) {
          dayOrdinary.set(shift.date, usedToday + span);
          cycleOrdinary += span;
        }
        from += span;
      }
    }
  }

  const scaled = (() => {
    // Someone paid above the award keeps that margin on every rate; nobody is costed below it.
    const award = toCents(rates.ordinary);
    const agreed = input.agreedHourly ? toCents(input.agreedHourly) : award;
    return Math.max(10_000, Math.round((agreed * 10_000) / award));
  })();
  const flat: AwardPayLine[] = [];
  const flatLine = (
    shift: AwardShift,
    kind: AwardPayKind,
    label: string,
    count: number,
    rate: string,
    clause: string,
  ) =>
    flat.push({
      shiftId: shift.id,
      kind,
      label,
      minutes: null,
      rate,
      cents: count * toCents(rate),
      costCents: count * toCents(rate),
      clause,
    });

  for (const { shift, start, end } of worked) {
    const minutes = workedMinutes.get(shift.id) ?? 0;
    const late = lateMinutes.get(shift.id);
    if (late?.evening) {
      if (rates.evening) {
        flatLine(
          shift,
          'loading',
          '10 pm to midnight, per hour or part',
          Math.ceil(late.evening / HOUR),
          rates.evening,
          '24.2',
        );
      } else
        warnings.push({
          shiftId: shift.id,
          clause: '24.2',
          message:
            'The extra amount for 10 pm to midnight is not in the pay database, so it was left out.',
        });
    }
    if (late?.night) {
      if (rates.night) {
        flatLine(
          shift,
          'loading',
          'Midnight to 6 am, per hour or part',
          Math.ceil(late.night / HOUR),
          rates.night,
          '24.2',
        );
      } else
        warnings.push({
          shiftId: shift.id,
          clause: '24.2',
          message:
            'The extra amount for midnight to 6 am is not in the pay database, so it was left out.',
        });
    }

    const onHoliday = holidayMinutes.get(shift.id) ?? 0;
    const holidayMinimum = casual ? HOLIDAY_MINIMUM.casual : HOLIDAY_MINIMUM.permanent;
    if (onHoliday > 0 && minutes < holidayMinimum) {
      add(
        shift,
        'minimumPayment',
        `Public holiday minimum of ${hours(holidayMinimum)}`,
        holidayMinimum - minutes,
        rates.publicHoliday,
        casual ? '24.4(b)' : '24.4(a)',
      );
    } else if (casual && minutes > 0 && minutes < CASUAL_MINIMUM) {
      const first = [...tally.values()].find((line) => line.shiftId === shift.id);
      add(
        shift,
        'minimumPayment',
        `Casual minimum of ${hours(CASUAL_MINIMUM)}`,
        CASUAL_MINIMUM - minutes,
        first?.rate ?? rates.ordinary,
        '11.3',
      );
    }

    if (minutes >= MEAL_BREAK_FROM && shift.unpaidBreakMinutes < MEAL_BREAK_MINUTES) {
      warnings.push({
        shiftId: shift.id,
        clause: '16.2',
        message: `A shift of ${hours(minutes)} needs an unpaid meal break of at least 30 minutes. If it is not given, half the ordinary rate extra is owed from when it was due (cl 16.5, 16.6).`,
      });
    }
    if (input.under18 && end - start > UNDER_18_SHIFT_MAX) {
      warnings.push({
        shiftId: shift.id,
        clause: '13.3',
        message: 'An employee under 18 must not be required to work more than 10 hours in a shift.',
      });
    }
    if (casual && minutes > CASUAL_DAILY_MAX) {
      warnings.push({
        shiftId: shift.id,
        clause: '11.2(a)',
        message:
          'A casual may be engaged for at most 12 hours a day or shift; the rest is overtime.',
      });
    }
  }

  // Day by day: split shifts, shortest and longest days, and the gap before the next start.
  const byDate = new Map<string, typeof worked>();
  for (const item of worked)
    byDate.set(item.shift.date, [...(byDate.get(item.shift.date) ?? []), item]);
  for (const [date, day] of byDate) {
    const first = day[0];
    const last = day[day.length - 1];
    if (!first || !last) continue;
    const total = day.reduce((sum, item) => sum + (workedMinutes.get(item.shift.id) ?? 0), 0);
    const holiday = input.publicHolidays.has(date);
    if (!casual && day.length > 1) {
      const periods = day.filter(
        (item) => (workedMinutes.get(item.shift.id) ?? 0) >= SPLIT_PERIOD_MIN,
      );
      if (rates.splitShift) {
        for (const item of periods) {
          flatLine(
            item.shift,
            'allowance',
            'Split shift allowance',
            1,
            rates.splitShift,
            '21.3(b)',
          );
        }
      } else if (periods.length > 0) {
        warnings.push({
          shiftId: first.shift.id,
          clause: '21.3(b)',
          message: 'The split shift allowance is not in the pay database, so it was left out.',
        });
      }
      if (last.end - first.start > SPLIT_SHIFT_SPREAD) {
        warnings.push({
          shiftId: first.shift.id,
          clause: '15.1(g)',
          message: 'The spread of a broken working day must not be more than 12 hours.',
        });
      }
    }
    if (employment === 'part_time' && total < PART_TIME_DAILY_MIN) {
      warnings.push({
        shiftId: first.shift.id,
        clause: '10.7(b)',
        message: 'A part-time employee must not be rostered for fewer than 3 hours in a day.',
      });
    }
    if (employment === 'part_time' && total > PERMANENT_DAILY_MAX) {
      warnings.push({
        shiftId: first.shift.id,
        clause: '10.7(b)',
        message: 'A part-time employee must not be rostered for more than 11.5 hours in a day.',
      });
    }
    if (employment === 'full_time' && !holiday && total < FULL_TIME_DAILY_MIN) {
      warnings.push({
        shiftId: first.shift.id,
        clause: '15.1(a)',
        message: 'A full-time employee works at least 6 ordinary hours on a day they work.',
      });
    }
  }
  if (!casual) {
    for (let index = 1; index < worked.length; index += 1) {
      const before = worked[index - 1];
      const next = worked[index];
      if (!before || !next || before.shift.date === next.shift.date) continue;
      if (next.start - before.end < BREAK_BETWEEN_SHIFTS) {
        warnings.push({
          shiftId: next.shift.id,
          clause: '15.1(e)',
          message:
            'There must be at least 10 hours between finishing work one day and starting the next.',
        });
      }
    }
  }
  if (employment === 'part_time' && input.weeks === 1 && byDate.size > 5) {
    warnings.push({
      shiftId: null,
      clause: '10.7(c)',
      message: 'A part-time employee must have 2 days off each week.',
    });
  }

  let minimumCents = 0;
  let costCents = 0;
  const costByShift: Record<string, number> = {};
  const count = (line: AwardPayLine, cost: number) => {
    line.costCents = cost;
    minimumCents += line.cents;
    costCents += cost;
    costByShift[line.shiftId] = (costByShift[line.shiftId] ?? 0) + cost;
    lines.push(line);
  };
  for (const line of tally.values()) {
    const base = (line.minutes ?? 0) * toCents(line.rate);
    line.cents = Math.round(base / HOUR);
    count(line, Math.round((base * scaled) / (HOUR * 10_000)));
  }
  // Flat amounts are the award's own figures and do not grow with an above-award rate.
  for (const line of flat) count(line, line.cents);
  lines.sort(
    (a, b) =>
      ordered.findIndex((shift) => shift.id === a.shiftId) -
      ordered.findIndex((shift) => shift.id === b.shiftId),
  );
  return { lines, minimumCents, costCents, costByShift, warnings };
}

export const MA000119: AwardInterpreter = {
  code: 'MA000119',
  name: 'Restaurant Industry Award 2020',
  textAsAt: '2026-07-01',
  notApplied: [
    'Work on a rostered day off (cl 23.1(d), (e)): rostered days off are not recorded.',
    'The 8-hour break after overtime (cl 23.2) and time off instead of overtime (cl 23.5).',
    'Limits counted over four weeks: days over 10 hours (cl 15.1(c), (d)) and 8 full days off (cl 15.1(f)).',
    'Meal allowances, tool and clothing allowances (cl 21.2, 21.4, 21.5), and the extra pay when a meal break is not given (cl 16.5, 16.6).',
    'Part-day public holidays, substituted holidays and the leave-instead arrangement (cl 24.4(c) to (g), 30.2).',
    'Annualised wage arrangements (cl 20), apprentice conditions (cl 12) and juniors serving liquor (cl 13.5).',
  ],
  pay,
};
