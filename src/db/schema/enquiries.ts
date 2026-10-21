import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Messages from the public website's "Let's talk" form: businesses interested in Meroidea.
 * Not tenant data: they belong to the platform and are read only by platform owners, through
 * `src/modules/enquiries`, on the server's privileged connection. RLS is on with no policies or
 * grants, so the public API cannot see them.
 */
export const websiteEnquiries = pgTable(
  'website_enquiries',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    email: text().notNull(),
    phone: text(),
    company: text().notNull(),
    businessType: text(),
    teamSize: text(),
    message: text().notNull(),
    /** new → contacted → closed; set by a platform owner. */
    status: text().notNull().default('new'),
    handledBy: uuid(),
    handledAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('website_enquiries_created_idx').on(table.createdAt),
    check('website_enquiries_status_check', sql`${table.status} in ('new', 'contacted', 'closed')`),
  ],
);
