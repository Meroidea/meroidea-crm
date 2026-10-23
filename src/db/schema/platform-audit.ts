import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * What platform owners did that no business's own audit log can hold, such as deleting a
 * business, whose audit log goes with it (ADR-056). Platform data: written and read only on the
 * server's privileged connection. RLS is on with no policies or grants. `business_id` has no
 * foreign key on purpose, so the record outlives the business.
 */
export const platformAuditLogs = pgTable(
  'platform_audit_logs',
  {
    id: uuid().primaryKey().defaultRandom(),
    actorUserId: uuid().notNull(),
    actorEmail: text().notNull(),
    action: text().notNull(),
    businessId: uuid(),
    businessName: text(),
    context: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('platform_audit_logs_created_idx').on(table.createdAt)],
);
