import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { contacts, organizations } from './crm';
import { opportunities } from './sales';
import { socialConversations } from './social';
import { tenantMemberships, tenants } from './tenancy';

/**
 * When a business counts time for its response targets (ADR-069): its opening hours by weekday,
 * in its own timezone, optionally skipping the public holidays it keeps (Rosters).
 */
export const businessHours = pgTable(
  'business_hours',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    /** IANA timezone the hours are in, e.g. Australia/Sydney. */
    timezone: text().notNull(),
    /** [{ day: 0–6 (Sunday = 0), opens: "09:00", closes: "17:00" }], several a day allowed. */
    weekly: jsonb().notNull().default([]),
    /** Skip the days listed in public_holidays. */
    skipPublicHolidays: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
  },
  (table) => [
    unique('business_hours_tenant_id_id_key').on(table.tenantId, table.id),
    check('business_hours_weekly_check', sql`jsonb_typeof(${table.weekly}) = 'array'`),
  ],
);

/**
 * Response targets by priority (ADR-069). One policy per business is the default and is given to
 * every new ticket. Without business hours, time counts around the clock.
 */
export const slaPolicies = pgTable(
  'sla_policies',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    isDefault: boolean().notNull().default(false),
    businessHoursId: uuid(),
    /** How far into a target (percent) a ticket counts as at risk. */
    atRiskPercent: smallint().notNull().default(75),
    /** Told when a target is breached, as well as the assignee. */
    escalateToUserId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
  },
  (table) => [
    unique('sla_policies_tenant_id_id_key').on(table.tenantId, table.id),
    uniqueIndex('sla_policies_one_default_key')
      .on(table.tenantId)
      .where(sql`${table.isDefault}`),
    foreignKey({
      name: 'sla_policies_hours_fkey',
      columns: [table.tenantId, table.businessHoursId],
      foreignColumns: [businessHours.tenantId, businessHours.id],
    }),
    foreignKey({
      name: 'sla_policies_escalate_fkey',
      columns: [table.tenantId, table.escalateToUserId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
    }),
    check('sla_policies_at_risk_check', sql`${table.atRiskPercent} between 1 and 99`),
  ],
);

/** A policy's two targets for one priority, in minutes of counted time. */
export const slaTargets = pgTable(
  'sla_targets',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    policyId: uuid().notNull(),
    /** low | normal | high | urgent */
    priority: text().notNull(),
    firstResponseMinutes: integer().notNull(),
    resolutionMinutes: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.policyId, table.priority] }),
    foreignKey({
      name: 'sla_targets_policy_fkey',
      columns: [table.tenantId, table.policyId],
      foreignColumns: [slaPolicies.tenantId, slaPolicies.id],
    }).onDelete('cascade'),
    check(
      'sla_targets_priority_check',
      sql`${table.priority} in ('low', 'normal', 'high', 'urgent')`,
    ),
    check(
      'sla_targets_minutes_check',
      sql`${table.firstResponseMinutes} between 1 and 525600 and ${table.resolutionMinutes} between 1 and 525600 and ${table.resolutionMinutes} >= ${table.firstResponseMinutes}`,
    ),
  ],
);

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
    /** The customer's organization (ADR-069): their primary one when the ticket was made. */
    organizationId: uuid(),
    /** The inbox conversation it came from; replies then go back through that channel. */
    conversationId: uuid(),
    category: text(),
    /** low | normal | high | urgent */
    priority: text().notNull().default('normal'),
    /** open → pending (waiting on customer) | on_hold → solved → closed */
    status: text().notNull().default('open'),
    assigneeUserId: uuid(),
    /** web_form | manual | conversation */
    source: text().notNull().default('manual'),
    /** Lets the customer follow and reply to their own ticket without a login. */
    publicToken: text().notNull(),
    /**
     * When a first reply is due. With an SLA policy (ADR-069) the database works this and every
     * column below out itself (trigger `tickets_sla`); sessions cannot write them.
     */
    responseDueAt: timestamp({ withTimezone: true }).notNull(),
    firstResponseAt: timestamp({ withTimezone: true }),
    solvedAt: timestamp({ withTimezone: true }),
    slaPolicyId: uuid(),
    /** When it should be solved by; empty while the clock is paused or without a policy. */
    resolutionDueAt: timestamp({ withTimezone: true }),
    firstResponseAtRiskAt: timestamp({ withTimezone: true }),
    resolutionAtRiskAt: timestamp({ withTimezone: true }),
    /** Since when the resolution clock has stood still (waiting on the customer, or solved). */
    slaPausedAt: timestamp({ withTimezone: true }),
    /** Counted minutes the resolution clock has stood still so far. */
    slaPausedMinutes: integer().notNull().default(0),
    firstResponseBreachedAt: timestamp({ withTimezone: true }),
    resolutionBreachedAt: timestamp({ withTimezone: true }),
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
    index('tickets_conversation_idx')
      .on(table.tenantId, table.conversationId)
      .where(sql`${table.conversationId} is not null`),
    // What the SLA sweep looks at: tickets still being worked.
    index('tickets_sla_idx')
      .on(table.responseDueAt, table.resolutionDueAt)
      .where(sql`${table.deletedAt} is null and ${table.status} in ('open', 'pending', 'on_hold')`),
    foreignKey({
      name: 'tickets_contact_fkey',
      columns: [table.tenantId, table.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }),
    foreignKey({
      name: 'tickets_organization_fkey',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizations.tenantId, organizations.id],
    }),
    foreignKey({
      name: 'tickets_conversation_fkey',
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [socialConversations.tenantId, socialConversations.id],
    }),
    foreignKey({
      name: 'tickets_sla_policy_fkey',
      columns: [table.tenantId, table.slaPolicyId],
      foreignColumns: [slaPolicies.tenantId, slaPolicies.id],
    }),
  ],
);

/** The opportunities a ticket concerns (ADR-069): the customer's open ones when it was made. */
export const ticketOpportunities = pgTable(
  'ticket_opportunities',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    ticketId: uuid().notNull(),
    opportunityId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
  },
  (table) => [
    primaryKey({ columns: [table.ticketId, table.opportunityId] }),
    foreignKey({
      name: 'ticket_opportunities_ticket_fkey',
      columns: [table.tenantId, table.ticketId],
      foreignColumns: [tickets.tenantId, tickets.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ticket_opportunities_opportunity_fkey',
      columns: [table.tenantId, table.opportunityId],
      foreignColumns: [opportunities.tenantId, opportunities.id],
    }).onDelete('cascade'),
    index('ticket_opportunities_opportunity_idx').on(table.tenantId, table.opportunityId),
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
