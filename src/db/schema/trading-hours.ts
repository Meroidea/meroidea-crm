import { sql } from 'drizzle-orm';
import { check, pgTable, smallint, time, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenancy';

/**
 * When the business trades, one row per weekday it has set (ADR-076). Recorded by the platform
 * owner at onboarding and kept up to date by the business's admin. MeroAI rosters from these, so
 * it never has to ask when a day starts or ends, and `staff_needed` says how many people should
 * be on while it is open. A weekday with no row, or with no times, is closed.
 */
export const tradingHours = pgTable(
  'trading_hours',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** 0 = Sunday … 6 = Saturday, as JavaScript's getUTCDay() counts. */
    weekday: smallint().notNull(),
    /** Wall-clock times in the business's timezone; both null when closed that day. */
    opensAt: time(),
    /** At or before `opens_at` means trading runs past midnight. */
    closesAt: time(),
    staffNeeded: smallint().notNull().default(1),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid(),
  },
  (table) => [
    unique('trading_hours_tenant_weekday_key').on(table.tenantId, table.weekday),
    unique('trading_hours_tenant_id_id_key').on(table.tenantId, table.id),
    check('trading_hours_weekday_check', sql`${table.weekday} between 0 and 6`),
    check(
      'trading_hours_times_check',
      sql`(${table.opensAt} is null) = (${table.closesAt} is null)`,
    ),
    check('trading_hours_staff_check', sql`${table.staffNeeded} between 1 and 50`),
  ],
);
