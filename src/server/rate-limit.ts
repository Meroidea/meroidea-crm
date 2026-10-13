import 'server-only';

import { createHmac } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { AppError } from '@/lib/errors';
import { adminDb } from '@/server/db/admin';
import { serverEnv } from '@/server/env';

/**
 * Per-sender limits for the public forms (ADR-039). Each form already has an hourly ceiling
 * across all senders; that ceiling alone let one script use up a business's allowance and lock
 * its real customers out. Counting per sender as well means one sender only ever uses up its own
 * share.
 *
 * Counters live in `public_rate_limits` as fixed windows, incremented with a single atomic
 * upsert, so concurrent requests cannot both slip under the limit. Addresses are stored only as
 * a keyed hash, so the table holds no personal data a leak could reverse.
 */

export type RateLimit = {
  /** Names one form or link, e.g. `helpdesk:<form id>`. */
  bucket: string;
  /** The sender's address; null when unknown, which shares one counter. */
  subject: string | null;
  limit: number;
  windowSeconds: number;
};

/** Expired windows are swept on roughly one call in this many, instead of by a scheduled job. */
const SWEEP_ONE_IN = 50;

function subjectKey(): Buffer {
  // A key derived from a server secret, separated by purpose, so the hashes cannot be matched
  // back to addresses by anyone without the server's environment.
  return createHmac('sha256', serverEnv().SUPABASE_SECRET_KEY)
    .update('meroidea:public-rate-limit:v1')
    .digest();
}

export function hashSubject(subject: string | null): string {
  return createHmac('sha256', subjectKey())
    .update(subject ?? 'unknown')
    .digest('base64url');
}

/** Counts this request and reports whether it is still within the limit. */
export async function consumeRateLimit(limit: RateLimit): Promise<boolean> {
  const db = adminDb();
  const rows = (await db.execute(sql`
    insert into public_rate_limits (bucket, subject_hash, window_start, hits)
    values (
      ${limit.bucket},
      ${hashSubject(limit.subject)},
      to_timestamp(floor(extract(epoch from now()) / ${limit.windowSeconds}) * ${limit.windowSeconds}),
      1
    )
    on conflict (bucket, subject_hash, window_start)
      do update set hits = public_rate_limits.hits + 1
    returning hits`)) as unknown as { hits: number }[];

  if (Math.floor(Math.random() * SWEEP_ONE_IN) === 0) {
    await db.execute(
      sql`delete from public_rate_limits where window_start < now() - interval '1 day'`,
    );
  }
  return (rows[0]?.hits ?? 0) <= limit.limit;
}

/** As consumeRateLimit, throwing RATE_LIMITED with `message` once the limit is passed. */
export async function enforceRateLimit(limit: RateLimit, message: string): Promise<void> {
  if (!(await consumeRateLimit(limit))) throw new AppError('RATE_LIMITED', message);
}
