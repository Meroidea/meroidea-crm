import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { contacts, leadSources, leadSubSources, leadType } from './crm';
import { teams, tenantMemberships, tenants } from './tenancy';

/**
 * How new leads, and leads handed over, are shared out (docs/leads.md §Routing). Rules are tried
 * in order; the first whose conditions all match picks someone from its pool.
 */
export const routingRules = pgTable(
  'routing_rules',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    /** intake: a new lead. handover: a lead passed from the SDR/BDR to a sales rep. */
    stage: text().notNull().default('intake'),
    /** Null: both workflows. */
    leadType: leadType(),
    /** Every listed condition must match; an empty list matches anything. */
    conditions: jsonb().notNull().default({}),
    /** round_robin | least_loaded */
    method: text().notNull().default('round_robin'),
    /** The people the rule shares leads between (members of this business). */
    userIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** Or everyone active in this team. */
    teamId: uuid(),
    lastAssignedUserId: uuid(),
    position: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('routing_rules_tenant_id_id_key').on(table.tenantId, table.id),
    index('routing_rules_order_idx').on(table.tenantId, table.stage, table.position),
    foreignKey({
      columns: [table.tenantId, table.teamId],
      foreignColumns: [teams.tenantId, teams.id],
      name: 'routing_rules_tenant_team_fk',
    }),
  ],
);

/** Reusable emails with merge fields such as {{contact.first_name}}. */
export const emailTemplates = pgTable(
  'email_templates',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    subject: text().notNull(),
    body: text().notNull(),
    isActive: boolean().notNull().default(true),
    createdBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('email_templates_tenant_id_id_key').on(table.tenantId, table.id),
    unique('email_templates_name_key').on(table.tenantId, table.name),
  ],
);

/** A form on the business's website that creates leads (contact us, enquiry, feedback). */
export const webForms = pgTable(
  'web_forms',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    /** In the form's address; not a secret, but unguessable so forms can't be enumerated. */
    publicKey: text().notNull().unique(),
    sourceId: uuid().notNull(),
    subSourceId: uuid(),
    leadType: leadType().notNull().default('b2c'),
    /** Shown after a successful submission. */
    thankYouMessage: text(),
    /** Ask for company and job title (B2B). */
    askCompany: boolean().notNull().default(false),
    /** Ask for a free-text message. */
    askMessage: boolean().notNull().default(true),
    /** Ask for consent to marketing. */
    askConsent: boolean().notNull().default(true),
    isActive: boolean().notNull().default(true),
    createdBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('web_forms_tenant_id_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.sourceId],
      foreignColumns: [leadSources.tenantId, leadSources.id],
      name: 'web_forms_tenant_source_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.sourceId, table.subSourceId],
      foreignColumns: [leadSubSources.tenantId, leadSubSources.sourceId, leadSubSources.id],
      name: 'web_forms_tenant_sub_source_fk',
    }),
  ],
);

/** Every submission as received, kept for audit and replay; processed idempotently. */
export const leadIntakeEvents = pgTable(
  'lead_intake_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    channel: text().notNull(),
    webFormId: uuid(),
    payload: jsonb().notNull(),
    /** received | created | matched | failed */
    status: text().notNull().default('received'),
    contactId: uuid(),
    error: text(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index('lead_intake_events_tenant_received_idx').on(table.tenantId, table.receivedAt.desc()),
    foreignKey({
      columns: [table.tenantId, table.webFormId],
      foreignColumns: [webForms.tenantId, webForms.id],
      name: 'lead_intake_events_tenant_form_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
      name: 'lead_intake_events_tenant_contact_fk',
    }),
  ],
);

/** In-app notices for one person; some are also emailed (without the record's details). */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid().notNull(),
    type: text().notNull(),
    title: text().notNull(),
    body: text(),
    url: text(),
    /** Makes a repeated alert (the same overdue lead) land once. */
    dedupeKey: text(),
    emailWanted: boolean().notNull().default(false),
    emailedAt: timestamp({ withTimezone: true }),
    readAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notifications_inbox_idx').on(
      table.tenantId,
      table.userId,
      table.readAt,
      table.createdAt.desc(),
    ),
    index('notifications_email_idx')
      .on(table.createdAt)
      .where(sql`${table.emailWanted} and ${table.emailedAt} is null`),
    unique('notifications_dedupe_key').on(table.tenantId, table.userId, table.dedupeKey),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
      name: 'notifications_tenant_user_fk',
    }).onDelete('cascade'),
  ],
);
