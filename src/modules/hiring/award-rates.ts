/**
 * Turns the Fair Work Commission's published rows for one classification into the schedule of
 * rates that applies to one kind of employment. Every dollar figure here is the Commission's
 * own: nothing is multiplied out or typed in. Where the published rows do not settle a figure,
 * the schedule says so instead of guessing.
 */

export type AwardEmployment = 'full_time' | 'part_time' | 'casual' | 'fixed_term';

/** The Commission's own grouping of who a rate is for. */
export type AwardEmployeeKind = 'adult' | 'junior' | 'apprentice' | 'adult_apprentice' | 'other';

export type AwardRateLine = {
  /** The Commission's wording, e.g. "Saturday" or "Monday to Friday - First 2 hours". */
  description: string;
  /** Per cent of the base rate, as published. */
  percent: number | null;
  /** Dollars per hour, as published for this classification. */
  hourly: string;
};

export type AwardRateGroup = { title: string; lines: AwardRateLine[] };

export type AwardAllowance = {
  name: string;
  amount: string;
  /** e.g. "per hour or part thereof", "per week". */
  frequency: string | null;
  clause: string | null;
};

/** Hourly rates for whole days, present only where the award publishes exactly one for each. */
export type AwardDayRates = {
  ordinary: string;
  saturday: string | null;
  sunday: string | null;
  publicHoliday: string | null;
};

export type AwardRateSchedule = {
  awardCode: string;
  classificationRef: string;
  employment: AwardEmployment;
  employeeKind: AwardEmployeeKind;
  /** The classification's base rate, before any casual loading. */
  baseHourly: string | null;
  baseWeekly: string | null;
  /** The least this kind of employee can be paid for an ordinary hour. */
  minimumHourly: string | null;
  /** Where `minimumHourly` came from, in the Commission's words, for whoever checks it. */
  minimumBasis: string;
  groups: AwardRateGroup[];
  dayRates: AwardDayRates | null;
  allowances: AwardAllowance[];
  /** The date the rates came into force, and the day they were read. */
  operativeFrom: string | null;
  fetchedOn: string;
};

export type RawPayRate = {
  base_pay_rate_id?: string | null;
  base_rate?: number | null;
  base_rate_type?: string | null;
  calculated_rate?: number | null;
  calculated_rate_type?: string | null;
  employee_rate_type_code?: string | null;
  operative_from?: string | null;
};

export type RawPenalty = {
  clause_description?: string | null;
  penalty_description?: string | null;
  rate?: number | null;
  penalty_calculated_value?: number | null;
  base_pay_rate_id?: string | null;
};

export type RawAllowance = {
  allowance?: string | null;
  allowance_amount?: number | null;
  payment_frequency?: string | null;
  clauses?: string | null;
};

const KINDS: Record<string, AwardEmployeeKind> = {
  AD: 'adult',
  JN: 'junior',
  AP: 'apprentice',
  AA: 'adult_apprentice',
};

export const EMPLOYEE_KIND_LABEL: Record<AwardEmployeeKind, string> = {
  adult: 'Adult',
  junior: 'Junior',
  apprentice: 'Apprentice',
  adult_apprentice: 'Adult apprentice',
  other: 'Other',
};

export const employeeKindOf = (code: string | null | undefined): AwardEmployeeKind =>
  KINDS[code ?? ''] ?? 'other';

const money = (value: number) => value.toFixed(2);

const CASUAL = /casual/i;
const PERMANENT = /(full|part)-?\s*time/i;
/** Groups that are not the ordinary day-worker table: paid on top of, or instead of, it. */
const NOT_ORDINARY = {
  test: (title: string) =>
    /overtime/i.test(title) || (/shift/i.test(title) && !/other than shift/i.test(title)),
};

const isFor = (title: string, employment: AwardEmployment) =>
  employment === 'casual' ? CASUAL.test(title) : PERMANENT.test(title) && !CASUAL.test(title);
/** A group that names the other kind of employment does not apply; one naming neither might. */
const isForOther = (title: string, employment: AwardEmployment) =>
  employment === 'casual' ? PERMANENT.test(title) && !CASUAL.test(title) : CASUAL.test(title);

/** Base hourly rate as published; weekly rates are for a 38-hour week. */
export function baseRates(rate: RawPayRate): { hourly: string | null; weekly: string | null } {
  const pairs = [
    [rate.base_rate, rate.base_rate_type],
    [rate.calculated_rate, rate.calculated_rate_type],
  ] as const;
  const of = (type: string) =>
    pairs.find(([value, kind]) => value && kind?.toLowerCase() === type)?.[0];
  const weekly = of('weekly');
  const hourly = of('hourly') ?? (weekly ? weekly / 38 : undefined);
  return { hourly: hourly ? money(hourly) : null, weekly: weekly ? money(weekly) : null };
}

const exactly = (lines: AwardRateLine[], pattern: RegExp): string | null => {
  const found = lines.filter((line) => pattern.test(line.description.trim()));
  return found.length === 1 ? (found[0]?.hourly ?? null) : null;
};

export function buildRateSchedule(input: {
  awardCode: string;
  classificationRef: string;
  employment: AwardEmployment;
  payRate: RawPayRate;
  penalties: RawPenalty[];
  allowances: RawAllowance[];
  today: string;
}): AwardRateSchedule {
  const { employment, payRate } = input;
  const base = baseRates(payRate);

  // A row with no dollar figure is one the Commission lists but does not apply at this level.
  const groups = new Map<string, AwardRateLine[]>();
  for (const row of input.penalties) {
    if (payRate.base_pay_rate_id && row.base_pay_rate_id !== payRate.base_pay_rate_id) continue;
    if (typeof row.penalty_calculated_value !== 'number') continue;
    const title = row.clause_description?.trim() || 'Rates';
    if (isForOther(title, employment)) continue;
    const lines = groups.get(title) ?? [];
    lines.push({
      description: row.penalty_description?.trim() || 'Rate',
      percent: row.rate ?? null,
      hourly: money(row.penalty_calculated_value),
    });
    groups.set(title, lines);
  }
  const ordered = [...groups.entries()]
    .map(([title, lines]) => ({
      title,
      lines: lines.sort((a, b) => Number(a.hourly) - Number(b.hourly)),
    }))
    // The ordinary table first, then overtime and shift work, then anything unlabelled.
    .sort(
      (a, b) =>
        Number(!isFor(a.title, employment)) - Number(!isFor(b.title, employment)) ||
        Number(NOT_ORDINARY.test(a.title)) - Number(NOT_ORDINARY.test(b.title)) ||
        a.title.localeCompare(b.title),
    );

  const ordinaryGroup = ordered.find(
    (group) => isFor(group.title, employment) && !NOT_ORDINARY.test(group.title),
  );
  const lowest = ordinaryGroup?.lines[0];

  let minimumHourly = base.hourly;
  let minimumBasis = 'The classification’s base rate.';
  if (employment === 'casual') {
    if (lowest) {
      minimumHourly = lowest.hourly;
      minimumBasis = `${ordinaryGroup?.title}: ${lowest.description}${
        lowest.percent ? ` (${lowest.percent}% of the base rate)` : ''
      }.`;
    } else {
      minimumHourly = null;
      minimumBasis =
        'The pay database lists no casual rate for this classification. Check the award for the casual loading.';
    }
  } else if (lowest && base.hourly === null) {
    minimumHourly = lowest.hourly;
    minimumBasis = `${ordinaryGroup?.title}: ${lowest.description}.`;
  }

  const ordinary = ordinaryGroup && lowest ? lowest.hourly : null;
  const dayRates: AwardDayRates | null =
    ordinaryGroup && ordinary
      ? {
          ordinary,
          saturday: exactly(ordinaryGroup.lines, /^saturday$/i),
          sunday: exactly(ordinaryGroup.lines, /^sunday(\s[-–—]\s.*)?$/i),
          publicHoliday: exactly(ordinaryGroup.lines, /^public holiday$/i),
        }
      : null;

  return {
    awardCode: input.awardCode,
    classificationRef: input.classificationRef,
    employment,
    employeeKind: employeeKindOf(payRate.employee_rate_type_code),
    baseHourly: base.hourly,
    baseWeekly: base.weekly,
    minimumHourly,
    minimumBasis,
    groups: ordered,
    dayRates,
    allowances: input.allowances.flatMap((row) =>
      row.allowance && typeof row.allowance_amount === 'number'
        ? [
            {
              name: row.allowance.trim(),
              amount: money(row.allowance_amount),
              frequency: row.payment_frequency?.trim() || null,
              clause: row.clauses?.trim() || null,
            },
          ]
        : [],
    ),
    operativeFrom: payRate.operative_from?.slice(0, 10) ?? null,
    fetchedOn: input.today,
  };
}

/** Day loadings relative to the ordinary rate, for costing a roster: Saturday 39.66 / 33.05. */
export function dayLoadings(rates: AwardDayRates | null): {
  saturday?: number;
  sunday?: number;
  publicHoliday?: number;
} {
  if (!rates) return {};
  const ordinary = Number(rates.ordinary);
  if (!(ordinary > 0)) return {};
  const ratio = (value: string | null) =>
    value ? Math.round((Number(value) / ordinary) * 10_000) / 10_000 : undefined;
  return {
    saturday: ratio(rates.saturday),
    sunday: ratio(rates.sunday),
    publicHoliday: ratio(rates.publicHoliday),
  };
}
