import 'server-only';

import { z } from 'zod';

import { AppError } from '@/lib/errors';
import {
  baseRates,
  buildRateSchedule,
  EMPLOYEE_KIND_LABEL,
  employeeKindOf,
  type AwardEmployment,
  type AwardRateSchedule,
} from '@/modules/hiring/award-rates';
import { serverEnv } from '@/server/env';

/**
 * Read-only client for the Fair Work Commission's Modern Awards Pay Database API
 * (https://api.fwc.gov.au, key from the Commission's developer portal). It is the source for
 * award names, classifications and their minimum rates, so those figures are never typed from
 * memory or hard-coded here: award rates change at least every July.
 *
 * The response shapes below follow the Commission's published data dictionary. Fields are parsed
 * leniently, because a missing optional field must not stop someone being hired.
 */
const BASE_URL = 'https://api.fwc.gov.au/api/v1/awards';
const MAX_PAGES = 40;

const page = <T extends z.ZodType>(row: T) =>
  z.object({
    results: z.array(row).default([]),
    _meta: z.object({ has_more_results: z.boolean().optional() }).loose().optional(),
  });

const awardRow = z
  .object({
    code: z.string(),
    name: z.string(),
    published_year: z.number().nullish(),
    award_operative_to: z.string().nullish(),
  })
  .loose();

const payRateRow = z
  .object({
    classification_fixed_id: z.number().nullish(),
    base_pay_rate_id: z.string().nullish(),
    classification: z.string().nullish(),
    parent_classification_name: z.string().nullish(),
    classification_level: z.number().nullish(),
    employee_rate_type_code: z.string().nullish(),
    base_rate: z.number().nullish(),
    base_rate_type: z.string().nullish(),
    calculated_rate: z.number().nullish(),
    calculated_rate_type: z.string().nullish(),
    operative_from: z.string().nullish(),
    operative_to: z.string().nullish(),
  })
  .loose();

const penaltyRow = z
  .object({
    clause_description: z.string().nullish(),
    penalty_description: z.string().nullish(),
    rate: z.number().nullish(),
    penalty_calculated_value: z.number().nullish(),
    base_pay_rate_id: z.string().nullish(),
    operative_from: z.string().nullish(),
    operative_to: z.string().nullish(),
  })
  .loose();

const allowanceRow = z
  .object({
    allowance: z.string().nullish(),
    allowance_amount: z.number().nullish(),
    payment_frequency: z.string().nullish(),
    clauses: z.string().nullish(),
    operative_from: z.string().nullish(),
    operative_to: z.string().nullish(),
  })
  .loose();

/**
 * The database keeps every past version of a row; only the one in force today is wanted. A row
 * that did not change is published again each year with the same dates, so of the rows in force
 * only the latest year's edition is kept.
 */
const today = () => new Date().toISOString().slice(0, 10);
const inForce = <
  T extends {
    operative_from?: string | null;
    operative_to?: string | null;
    published_year?: unknown;
  },
>(
  rows: T[],
): T[] => {
  const day = today();
  const current = rows.filter(
    (row) =>
      (!row.operative_to || row.operative_to.slice(0, 10) >= day) &&
      (!row.operative_from || row.operative_from.slice(0, 10) <= day),
  );
  const year = (row: T) => (typeof row.published_year === 'number' ? row.published_year : 0);
  const latest = Math.max(0, ...current.map(year));
  return current.filter((row) => year(row) === latest);
};

export type AwardOption = { code: string; name: string };
export type ClassificationOption = { ref: string; label: string };
export type MinimumRate = {
  /** Dollars per hour, as published or derived from the weekly rate over 38 hours. */
  hourly: string | null;
  weekly: string | null;
  operativeFrom: string | null;
};

export function isFairWorkConfigured(): boolean {
  return Boolean(serverEnv().FWC_API_KEY);
}

async function get<T extends z.ZodType>(
  path: string,
  params: Record<string, string>,
  row: T,
): Promise<z.infer<T>[]> {
  const apiKey = serverEnv().FWC_API_KEY;
  if (!apiKey) {
    throw new AppError('INTERNAL', 'The Fair Work pay database is not connected to this system.');
  }
  const rows: z.infer<T>[] = [];
  // Past versions are returned too, so one classification's rates can span several pages.
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [name, value] of Object.entries({
      ...params,
      limit: '100',
      page: String(pageNumber),
    })) {
      url.searchParams.set(name, value);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'Ocp-Apim-Subscription-Key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
        // Rates move once a year; an hour-old answer is fine and keeps us well inside any quota.
        next: { revalidate: 3600 },
      });
    } catch {
      throw new AppError('INTERNAL', 'The Fair Work pay database did not respond. Try again.');
    }
    if (response.status === 404) return rows;
    if (!response.ok) {
      console.error('[fair-work] request refused', { status: response.status });
      throw new AppError('INTERNAL', 'The Fair Work pay database refused the request.');
    }
    const parsed = page(row).safeParse(await response.json());
    if (!parsed.success) {
      console.error('[fair-work] unexpected response shape');
      throw new AppError(
        'INTERNAL',
        'The Fair Work pay database sent an answer we could not read.',
      );
    }
    rows.push(...(parsed.data.results as z.infer<T>[]));
    if (!parsed.data._meta?.has_more_results) return rows;
  }
  // Stopping short would silently drop current rates, which is worse than failing.
  throw new AppError('INTERNAL', 'The Fair Work pay database returned more than we could read.');
}

/** Current awards whose name contains `name`. Each award appears once, however many versions. */
export async function searchAwards(name: string): Promise<AwardOption[]> {
  const rows = await get('', { name }, awardRow);
  const current = new Map<string, AwardOption>();
  for (const row of rows) {
    if (row.award_operative_to) continue;
    current.set(row.code, { code: row.code, name: row.name });
  }
  return [...current.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25);
}

/**
 * The classifications that currently carry a rate, read from the pay-rate rows so each one says
 * who it is for: an adult, a junior of a given age, or an apprentice in a given year.
 */
export async function listClassifications(awardCode: string): Promise<ClassificationOption[]> {
  const rows = inForce(await get(`/${encodeURIComponent(awardCode)}/pay-rates`, {}, payRateRow));
  const seen = new Map<string, ClassificationOption & { level: number; kind: string }>();
  for (const row of rows) {
    if (!row.classification_fixed_id || !row.base_rate) continue;
    // Awards put the level in either field and the job titles in the other; lead with the
    // shorter one so the level reads first. A bare number in the parent field is an internal code.
    const parts = [row.parent_classification_name, row.classification]
      .flatMap((part) => (part && !/^\d+$/.test(part.trim()) ? [part.trim()] : []))
      .sort((a, b) => a.length - b.length);
    if (parts.length === 0) continue;
    const kind = employeeKindOf(row.employee_rate_type_code);
    seen.set(String(row.classification_fixed_id), {
      ref: String(row.classification_fixed_id),
      label: `${EMPLOYEE_KIND_LABEL[kind]}: ${parts.join(' — ')}`,
      level: row.classification_level ?? 0,
      kind: EMPLOYEE_KIND_LABEL[kind],
    });
  }
  return [...seen.values()]
    .sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        a.level - b.level ||
        a.label.localeCompare(b.label, undefined, { numeric: true }),
    )
    .map(({ ref, label }) => ({ ref, label }));
}

async function currentPayRate(awardCode: string, classificationRef: string) {
  const rows = inForce(
    await get(
      `/${encodeURIComponent(awardCode)}/pay-rates`,
      { classification_fixed_id: classificationRef },
      payRateRow,
    ),
  );
  return rows
    .filter((row) => String(row.classification_fixed_id) === classificationRef && row.base_rate)
    .sort((a, b) => (b.operative_from ?? '').localeCompare(a.operative_from ?? ''))[0];
}

/** The base minimum currently in force for one classification, or null when none is published. */
export async function getMinimumRate(
  awardCode: string,
  classificationRef: string,
): Promise<MinimumRate | null> {
  const rate = await currentPayRate(awardCode, classificationRef);
  if (!rate) return null;
  const { hourly, weekly } = baseRates(rate);
  if (!hourly && !weekly) return null;
  return { hourly, weekly, operativeFrom: rate.operative_from?.slice(0, 10) ?? null };
}

/**
 * Everything the Commission publishes for one classification and one kind of employment: the
 * minimum for an ordinary hour (with the casual loading for a casual), the penalty and overtime
 * rates in dollars, and the award's allowances. Null when the classification has no current rate.
 */
export async function getAwardRates(
  awardCode: string,
  classificationRef: string,
  employment: AwardEmployment,
): Promise<AwardRateSchedule | null> {
  const payRate = await currentPayRate(awardCode, classificationRef);
  if (!payRate) return null;
  const award = `/${encodeURIComponent(awardCode)}`;
  const [penalties, wage, expense] = await Promise.all([
    payRate.base_pay_rate_id
      ? get(`${award}/penalties`, { base_pay_rate_Id: payRate.base_pay_rate_id }, penaltyRow)
      : Promise.resolve([]),
    get(`${award}/wage-allowances`, {}, allowanceRow),
    get(`${award}/expense-allowances`, {}, allowanceRow),
  ]);
  return buildRateSchedule({
    awardCode,
    classificationRef,
    employment,
    payRate,
    penalties: inForce(penalties),
    allowances: [...inForce(wage), ...inForce(expense)],
    today: today(),
  });
}
