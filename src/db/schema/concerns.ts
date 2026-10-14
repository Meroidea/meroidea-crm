import { foreignKey, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { payslips } from './finance';
import { tenants } from './tenancy';

/**
 * A question or concern a member of staff raises with the business's managers or its admin
 * (ADR-049): hours on a payslip, a shift, leave, or anything they need to talk about. Whom it is
 * raised with decides who can read it: managers cannot see pay, so a question raised with the
 * admin only is hidden from them. Kept as the record of what was asked and answered; never deleted.
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
    /** The payslip it is about, when asked from one. Only the person's own payslip (RLS). */
    payslipId: uuid(),
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
    foreignKey({
      columns: [table.tenantId, table.payslipId],
      foreignColumns: [payslips.tenantId, payslips.id],
      name: 'concerns_payslip_fk',
    }).onDelete('restrict'),
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
