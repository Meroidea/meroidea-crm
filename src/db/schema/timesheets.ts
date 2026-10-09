import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenancy';

/**
 * One stretch of work a person recorded: clocked in and out, or entered by hand afterwards.
 * Approved entries can be used as the hours on a payslip instead of the rostered hours.
 */
export const timeEntries = pgTable(
  'time_entries',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid().notNull(),
    clockIn: timestamp({ withTimezone: true }).notNull(),
    /** Null while the person is still clocked in. */
    clockOut: timestamp({ withTimezone: true }),
    breakMinutes: integer().notNull().default(0),
    note: text(),
    /** Metres from the business when clocking in and out; null when no location is required. */
    clockInDistanceM: integer(),
    clockOutDistanceM: integer(),
    /** clock = pressed the button; manual = typed in afterwards. */
    source: text().notNull().default('clock'),
    /** pending → approved | rejected. */
    status: text().notNull().default('pending'),
    decidedBy: uuid(),
    decidedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index('time_entries_person_idx')
      .on(table.tenantId, table.userId, table.clockIn)
      .where(sql`${table.deletedAt} is null`),
    index('time_entries_period_idx')
      .on(table.tenantId, table.clockIn)
      .where(sql`${table.deletedAt} is null`),
    // A person can only be clocked in once at a time.
    uniqueIndex('time_entries_one_open_key')
      .on(table.tenantId, table.userId)
      .where(sql`${table.clockOut} is null and ${table.deletedAt} is null`),
  ],
);
