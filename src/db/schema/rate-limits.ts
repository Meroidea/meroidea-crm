import { index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Fixed-window counters for the public forms (ADR-039). Not tenant data: a bucket names one
 * form or link, and the subject is a keyed hash of the sender's address, never the address
 * itself. Reached only through `src/server/rate-limit.ts`; RLS is on with no policies or
 * grants, so the public API cannot see it.
 */
export const publicRateLimits = pgTable(
  'public_rate_limits',
  {
    bucket: text().notNull(),
    subjectHash: text().notNull(),
    windowStart: timestamp({ withTimezone: true }).notNull(),
    hits: integer().notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.bucket, table.subjectHash, table.windowStart] }),
    index('public_rate_limits_window_idx').on(table.windowStart),
  ],
);
