import 'server-only';

import { z } from 'zod';

import { AppError } from '@/lib/errors';
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

const page = <T extends z.ZodType>(row: T) =>
  z.object({
    results: z.array(row).default([]),
    _meta: z.object({ page_count: z.number().optional() }).loose().optional(),
  });

const awardRow = z
  .object({
    code: z.string(),
    name: z.string(),
    published_year: z.number().nullish(),
    award_operative_to: z.string().nullish(),
  })
  .loose();

const classificationRow = z
  .object({
    classification_fixed_id: z.number(),
    classification: z.string().nullish(),
    classification_level: z.number().nullish(),
    parent_classification_name: z.string().nullish(),
    employee_rate_type_code: z.string().nullish(),
  })
  .loose();

const payRateRow = z
  .object({
    classification_fixed_id: z.number().nullish(),
    base_rate: z.number().nullish(),
    base_rate_type: z.string().nullish(),
    calculated_rate: z.number().nullish(),
    calculated_rate_type: z.string().nullish(),
    operative_from: z.string().nullish(),
    operative_to: z.string().nullish(),
  })
  .loose();

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
  const url = new URL(`${BASE_URL}${path}`);
  for (const [name, value] of Object.entries({ ...params, limit: '100' })) {
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
  if (response.status === 404) return [];
  if (!response.ok) {
    console.error('[fair-work] request refused', { status: response.status });
    throw new AppError('INTERNAL', 'The Fair Work pay database refused the request.');
  }
  const parsed = page(row).safeParse(await response.json());
  if (!parsed.success) {
    console.error('[fair-work] unexpected response shape');
    throw new AppError('INTERNAL', 'The Fair Work pay database sent an answer we could not read.');
  }
  return parsed.data.results as z.infer<T>[];
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

export async function listClassifications(awardCode: string): Promise<ClassificationOption[]> {
  const rows = await get(
    `/${encodeURIComponent(awardCode)}/classifications`,
    {},
    classificationRow,
  );
  const seen = new Map<string, ClassificationOption>();
  for (const row of rows) {
    const parts = [row.parent_classification_name, row.classification].filter(Boolean);
    if (parts.length === 0) continue;
    seen.set(String(row.classification_fixed_id), {
      ref: String(row.classification_fixed_id),
      label: parts.join(' — '),
    });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

const money = (value: number) => value.toFixed(2);

/** The minimum currently in force for one classification, or null when none is published. */
export async function getMinimumRate(
  awardCode: string,
  classificationRef: string,
): Promise<MinimumRate | null> {
  const rows = await get(
    `/${encodeURIComponent(awardCode)}/classifications/${encodeURIComponent(classificationRef)}/pay-rates`,
    {},
    payRateRow,
  );
  const today = new Date().toISOString().slice(0, 10);
  const inForce = rows
    .filter((row) => !row.operative_to || row.operative_to.slice(0, 10) >= today)
    .filter((row) => !row.operative_from || row.operative_from.slice(0, 10) <= today)
    .sort((a, b) => (b.operative_from ?? '').localeCompare(a.operative_from ?? ''))[0];
  if (!inForce) return null;

  const rates = [
    [inForce.base_rate, inForce.base_rate_type],
    [inForce.calculated_rate, inForce.calculated_rate_type],
  ] as const;
  const of = (type: string) =>
    rates.find(([rate, kind]) => rate && kind?.toLowerCase() === type)?.[0];
  const weekly = of('weekly');
  const hourly = of('hourly') ?? (weekly ? weekly / 38 : undefined);
  if (!hourly && !weekly) return null;
  return {
    hourly: hourly ? money(hourly) : null,
    weekly: weekly ? money(weekly) : null,
    operativeFrom: inForce.operative_from?.slice(0, 10) ?? null,
  };
}
