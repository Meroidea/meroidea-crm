import { foreignKey, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenancy';

/**
 * Something a member of staff raises with their managers or with the business's admin
 * (ADR-049). Who can read it depends on whom it was raised with: one raised with the admin is
 * hidden from managers, so a concern about a manager stays between the person and the admin.
 * Concerns are a record of what was raised and answered, so they are never deleted.
 */
export const concerns = pgTable(
  'concerns',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** The person who raised it; always the signed-in user at the time (RLS). */
    raisedBy: uuid().notNull(),
    /** 'manager': managers and the admin can read it. 'admin': only the admin can. */
    raisedWith: text().notNull(),
    category: text().notNull(),
    subject: text().notNull(),
    /** open → in_progress → resolved; a resolved concern can be reopened. */
    status: text().notNull().default('open'),
    resolvedAt: timestamp({ withTimezone: true }),
    resolvedBy: uuid(),
    /** Moves with every reply, so the most recently active concerns sort first. */
    lastActivityAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('concerns_tenant_id_id_key').on(table.tenantId, table.id),
    index('concerns_tenant_activity_idx').on(table.tenantId, table.lastActivityAt),
    index('concerns_tenant_raised_by_idx').on(table.tenantId, table.raisedBy),
  ],
);

/** The conversation on a concern: what was raised first, then every reply, in order. */
export const concernMessages = pgTable(
  'concern_messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    concernId: uuid().notNull(),
    /** Always the signed-in user at the time (RLS). */
    authorUserId: uuid().notNull(),
    body: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('concern_messages_tenant_id_id_key').on(table.tenantId, table.id),
    index('concern_messages_concern_idx').on(table.tenantId, table.concernId, table.createdAt),
    foreignKey({
      columns: [table.tenantId, table.concernId],
      foreignColumns: [concerns.tenantId, concerns.id],
      name: 'concern_messages_concern_fk',
    }).onDelete('restrict'),
  ],
);
