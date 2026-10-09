import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenants } from './tenancy';

/** One per business: its public "contact support" form. */
export const helpdeskForms = pgTable(
  'helpdesk_forms',
  {
    tenantId: uuid()
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    publicToken: text().notNull(),
    isOpen: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('helpdesk_forms_public_token_key').on(table.publicToken)],
);

/** A customer's request for help, from first contact to closed. */
export const tickets = pgTable(
  'tickets',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** Counts up per business; shown as #1042. */
    number: integer().notNull(),
    subject: text().notNull(),
    requesterName: text().notNull(),
    requesterEmail: text(),
    /** The CRM contact with the same email, when there is one. */
    contactId: uuid(),
    category: text(),
    /** low | normal | high | urgent */
    priority: text().notNull().default('normal'),
    /** open → pending (waiting on customer) | on_hold → solved → closed */
    status: text().notNull().default('open'),
    assigneeUserId: uuid(),
    /** web_form | manual */
    source: text().notNull().default('manual'),
    /** Lets the customer follow and reply to their own ticket without a login. */
    publicToken: text().notNull(),
    /** When a first reply is due, from the priority at creation. */
    responseDueAt: timestamp({ withTimezone: true }).notNull(),
    firstResponseAt: timestamp({ withTimezone: true }),
    solvedAt: timestamp({ withTimezone: true }),
    /** The last time the customer or staff wrote on it; drives the list order. */
    lastActivityAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    unique('tickets_tenant_id_id_key').on(table.tenantId, table.id),
    unique('tickets_tenant_number_key').on(table.tenantId, table.number),
    uniqueIndex('tickets_public_token_key').on(table.publicToken),
    index('tickets_queue_idx')
      .on(table.tenantId, table.status, table.lastActivityAt)
      .where(sql`${table.deletedAt} is null`),
    index('tickets_assignee_idx')
      .on(table.tenantId, table.assigneeUserId, table.status)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/** Everything written on a ticket: the customer's messages, staff replies, and private notes. */
export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    ticketId: uuid().notNull(),
    /** Null when the customer wrote it. */
    authorUserId: uuid(),
    authorName: text().notNull(),
    body: text().notNull(),
    /** A private note for staff; never shown to the customer. */
    isInternal: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'ticket_messages_ticket_fkey',
      columns: [table.tenantId, table.ticketId],
      foreignColumns: [tickets.tenantId, tickets.id],
    }).onDelete('cascade'),
    index('ticket_messages_thread_idx').on(table.tenantId, table.ticketId, table.createdAt),
  ],
);
