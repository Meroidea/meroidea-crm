import { sql } from 'drizzle-orm';
import { char, date, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenancy';

/** Money a person spent for the business and wants back. */
export const expenseClaims = pgTable(
  'expense_claims',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** The person who paid. */
    userId: uuid().notNull(),
    spentOn: date({ mode: 'string' }).notNull(),
    /** Free text with suggestions; each business uses its own words. */
    category: text().notNull(),
    merchant: text(),
    description: text(),
    amount: numeric({ precision: 14, scale: 2 }).notNull(),
    currency: char({ length: 3 }).notNull(),
    /** Server-chosen path of the receipt in the private bucket, if one was attached. */
    receiptPath: text(),
    receiptName: text(),
    /** submitted → approved | declined; approved → reimbursed. */
    status: text().notNull().default('submitted'),
    decidedBy: uuid(),
    decidedAt: timestamp({ withTimezone: true }),
    decisionNote: text(),
    reimbursedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index('expense_claims_person_idx')
      .on(table.tenantId, table.userId, table.spentOn)
      .where(sql`${table.deletedAt} is null`),
    index('expense_claims_status_idx')
      .on(table.tenantId, table.status)
      .where(sql`${table.deletedAt} is null`),
  ],
);
