import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenantMemberships, tenants } from './tenancy';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

const authorship = {
  createdBy: uuid(),
  updatedBy: uuid(),
  deletedAt: timestamp({ withTimezone: true }),
};

export const leadSourceType = pgEnum('lead_source_type', [
  'manual',
  'web_form',
  'social',
  'referral',
  'partner',
  'walk_in',
  'import',
  'api',
  'other',
]);

export const contactStatus = pgEnum('contact_status', ['active', 'inactive', 'do_not_contact']);

/** Which lead workflow a contact follows (docs/leads.md): selling to a business or to a person. */
export const leadType = pgEnum('lead_type', ['b2b', 'b2c']);

/**
 * What a lead status means to the system. Businesses name and add statuses freely; the kind
 * decides behaviour: `new` starts the first-contact timer, `pending_acceptance` waits on the
 * person a lead was handed to, `returned` is a handover they rejected, `converted` has an
 * opportunity, `closed` ends qualification (with a reason when the status asks for one).
 */
export const leadStatusKind = pgEnum('lead_status_kind', [
  'new',
  'working',
  'pending_acceptance',
  'returned',
  'converted',
  'closed',
]);

/** `disqualify`: why a lead was closed. `reject`: why a handover was turned down. */
export const leadReasonKind = pgEnum('lead_reason_kind', ['disqualify', 'reject']);

export const customEntity = pgEnum('custom_entity', ['contact', 'organization', 'opportunity']);
export const customFieldType = pgEnum('custom_field_type', [
  'text',
  'textarea',
  'number',
  'date',
  'boolean',
  'select',
  'multi_select',
  'email',
  'phone',
  'url',
]);

export const leadSources = pgTable(
  'lead_sources',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    type: leadSourceType().notNull().default('manual'),
    isActive: boolean().notNull().default(true),
    position: integer().notNull().default(0),
    ...timestamps,
  },
  (table) => [
    unique('lead_sources_tenant_id_id_key').on(table.tenantId, table.id),
    unique('lead_sources_tenant_id_name_key').on(table.tenantId, table.name),
  ],
);

/** The finer channel under a source: "Meta ads" under "Marketing". Optional per source. */
export const leadSubSources = pgTable(
  'lead_sub_sources',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    sourceId: uuid().notNull(),
    name: text().notNull(),
    isActive: boolean().notNull().default(true),
    position: integer().notNull().default(0),
    ...timestamps,
  },
  (table) => [
    unique('lead_sub_sources_tenant_id_id_key').on(table.tenantId, table.id),
    unique('lead_sub_sources_source_id_key').on(table.tenantId, table.sourceId, table.id),
    unique('lead_sub_sources_name_key').on(table.tenantId, table.sourceId, table.name),
    foreignKey({
      columns: [table.tenantId, table.sourceId],
      foreignColumns: [leadSources.tenantId, leadSources.id],
      name: 'lead_sub_sources_tenant_source_fk',
    }).onDelete('cascade'),
  ],
);

export const leadStatuses = pgTable(
  'lead_statuses',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    kind: leadStatusKind().notNull(),
    /** Null: both workflows use it. */
    leadType: leadType(),
    requiresReason: boolean().notNull().default(false),
    /** The status the system moves a lead into for its kind (exactly one per kind and type). */
    isSystem: boolean().notNull().default(false),
    color: text(),
    isActive: boolean().notNull().default(true),
    position: integer().notNull().default(0),
    ...timestamps,
  },
  (table) => [
    unique('lead_statuses_tenant_id_id_key').on(table.tenantId, table.id),
    index('lead_statuses_tenant_position_idx').on(table.tenantId, table.position),
  ],
);

export const leadReasons = pgTable(
  'lead_reasons',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    kind: leadReasonKind().notNull(),
    name: text().notNull(),
    isActive: boolean().notNull().default(true),
    position: integer().notNull().default(0),
    ...timestamps,
  },
  (table) => [
    unique('lead_reasons_tenant_id_id_key').on(table.tenantId, table.id),
    unique('lead_reasons_name_key').on(table.tenantId, table.kind, table.name),
  ],
);

/** One upload of a spreadsheet of leads, with what happened to its rows. */
export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    fileName: text().notNull(),
    sourceId: uuid(),
    subSourceId: uuid(),
    campaignName: text(),
    leadType: leadType(),
    duplicateStrategy: text().notNull().default('skip'),
    rowCount: integer().notNull().default(0),
    createdCount: integer().notNull().default(0),
    mergedCount: integer().notNull().default(0),
    skippedCount: integer().notNull().default(0),
    duplicateCreatedCount: integer().notNull().default(0),
    errorCount: integer().notNull().default(0),
    /** Row-level outcomes for the report: [{row, outcome, reason?, contactId?}]. */
    report: jsonb().notNull().default([]),
    createdBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    unique('import_batches_tenant_id_id_key').on(table.tenantId, table.id),
    index('import_batches_tenant_created_idx').on(table.tenantId, table.createdAt.desc()),
    foreignKey({
      columns: [table.tenantId, table.sourceId],
      foreignColumns: [leadSources.tenantId, leadSources.id],
      name: 'import_batches_tenant_source_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.subSourceId],
      foreignColumns: [leadSubSources.tenantId, leadSubSources.id],
      name: 'import_batches_tenant_sub_source_fk',
    }),
  ],
);

/** Fields a business adds to its records; values live in `<entity>.custom_fields`. */
export const customFieldDefinitions = pgTable(
  'custom_field_definitions',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    entityType: customEntity().notNull(),
    /** snake_case and immutable: it is the JSON key in custom_fields. */
    key: text().notNull(),
    label: text().notNull(),
    description: text(),
    fieldType: customFieldType().notNull(),
    /** select / multi_select: { choices: [{ value, label }] }. */
    options: jsonb().notNull().default({}),
    isRequired: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    showInList: boolean().notNull().default(false),
    position: integer().notNull().default(0),
    ...timestamps,
  },
  (table) => [
    unique('custom_field_definitions_tenant_id_id_key').on(table.tenantId, table.id),
    unique('custom_field_definitions_key').on(table.tenantId, table.entityType, table.key),
  ],
);

export const organizations = pgTable(
  'organizations',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    /** Tenant-configurable via settings.organization_types ('institution', 'agency', …). */
    type: text(),
    email: text(),
    phone: text(),
    website: text(),
    /** The website's bare host (example.com), used to find the same company twice. */
    domain: text(),
    industry: text(),
    companySize: text(),
    linkedinUrl: text(),
    addressLine: text(),
    city: text(),
    region: text(),
    country: char({ length: 2 }),
    ownerUserId: uuid(),
    customFields: jsonb().notNull().default({}),
    ...timestamps,
    ...authorship,
  },
  (table) => [
    unique('organizations_tenant_id_id_key').on(table.tenantId, table.id),
    index('organizations_tenant_name_idx')
      .on(table.tenantId, table.name)
      .where(sql`${table.deletedAt} is null`),
    index('organizations_tenant_domain_idx')
      .on(table.tenantId, table.domain)
      .where(sql`${table.deletedAt} is null and ${table.domain} is not null`),
    foreignKey({
      columns: [table.tenantId, table.ownerUserId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
      name: 'organizations_tenant_owner_fk',
    }),
  ],
);

export const contacts = pgTable(
  'contacts',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    firstName: text().notNull(),
    lastName: text(),
    fullName: text().generatedAlwaysAs(sql`trim(first_name || ' ' || coalesce(last_name, ''))`),
    email: text(),
    /** lower(trim(email)); set by the service, used for duplicate detection. */
    emailNormalized: text(),
    phone: text(),
    /** Normalized with the tenant's default country; used for duplicate detection. */
    phoneE164: text('phone_e164'),
    altPhone: text(),
    /** Sensitive: only returned with contacts.view_sensitive. */
    dateOfBirth: date(),
    gender: text(),
    addressLine: text(),
    city: text(),
    region: text(),
    country: char({ length: 2 }),
    status: contactStatus().notNull().default('active'),
    ownerUserId: uuid(),
    sourceId: uuid(),
    marketingConsent: boolean().notNull().default(false),
    consentUpdatedAt: timestamp({ withTimezone: true }),
    customFields: jsonb().notNull().default({}),
    lastActivityAt: timestamp({ withTimezone: true }),

    // Lead qualification (docs/leads.md). A lead is a contact being qualified, not its own object.
    leadType: leadType(),
    leadStatusId: uuid(),
    leadStatusChangedAt: timestamp({ withTimezone: true }),
    leadReasonId: uuid(),
    leadReasonNote: text(),
    subSourceId: uuid(),
    campaignName: text(),
    /** utm_source, utm_medium, utm_campaign, utm_term, utm_content from a web form. */
    utm: jsonb(),
    importBatchId: uuid(),
    jobTitle: text(),
    companyName: text(),
    companyWebsite: text(),
    companySize: text(),
    industry: text(),
    linkedinUrl: text(),
    language: text(),
    interest: text(),
    /** Who first worked the lead (the SDR/BDR); kept after handover for credit and reports. */
    originatorUserId: uuid(),
    assignedAt: timestamp({ withTimezone: true }),
    firstContactedAt: timestamp({ withTimezone: true }),
    handoverToUserId: uuid(),
    handoverAt: timestamp({ withTimezone: true }),
    handoverDueAt: timestamp({ withTimezone: true }),
    handoverMeetingAt: timestamp({ withTimezone: true }),
    handoverSummary: text(),
    rejectedReasonId: uuid(),
    rejectedNote: text(),
    rejectedAt: timestamp({ withTimezone: true }),
    rejectedBy: uuid(),
    convertedAt: timestamp({ withTimezone: true }),
    doNotEmail: boolean().notNull().default(false),
    doNotCall: boolean().notNull().default(false),
    /** Where marketing consent was given: web form, import, in person… */
    consentSource: text(),
    anonymizedAt: timestamp({ withTimezone: true }),
    search: tsvector().generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, ''))`,
    ),
    ...timestamps,
    ...authorship,
  },
  (table) => [
    unique('contacts_tenant_id_id_key').on(table.tenantId, table.id),
    index('contacts_tenant_owner_idx')
      .on(table.tenantId, table.ownerUserId)
      .where(sql`${table.deletedAt} is null`),
    index('contacts_tenant_created_idx')
      .on(table.tenantId, table.createdAt.desc(), table.id.desc())
      .where(sql`${table.deletedAt} is null`),
    index('contacts_tenant_email_idx')
      .on(table.tenantId, table.emailNormalized)
      .where(sql`${table.deletedAt} is null and ${table.emailNormalized} is not null`),
    index('contacts_tenant_phone_idx')
      .on(table.tenantId, table.phoneE164)
      .where(sql`${table.deletedAt} is null and ${table.phoneE164} is not null`),
    index('contacts_search_idx').using('gin', table.search),
    index('contacts_custom_fields_idx').using('gin', table.customFields.op('jsonb_path_ops')),
    foreignKey({
      columns: [table.tenantId, table.ownerUserId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
      name: 'contacts_tenant_owner_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.sourceId],
      foreignColumns: [leadSources.tenantId, leadSources.id],
      name: 'contacts_tenant_source_fk',
    }),
    // The sub-source must belong to the contact's source.
    foreignKey({
      columns: [table.tenantId, table.sourceId, table.subSourceId],
      foreignColumns: [leadSubSources.tenantId, leadSubSources.sourceId, leadSubSources.id],
      name: 'contacts_tenant_sub_source_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.leadStatusId],
      foreignColumns: [leadStatuses.tenantId, leadStatuses.id],
      name: 'contacts_tenant_lead_status_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.leadReasonId],
      foreignColumns: [leadReasons.tenantId, leadReasons.id],
      name: 'contacts_tenant_lead_reason_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.rejectedReasonId],
      foreignColumns: [leadReasons.tenantId, leadReasons.id],
      name: 'contacts_tenant_rejected_reason_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.importBatchId],
      foreignColumns: [importBatches.tenantId, importBatches.id],
      name: 'contacts_tenant_import_batch_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.originatorUserId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
      name: 'contacts_tenant_originator_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.handoverToUserId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
      name: 'contacts_tenant_handover_to_fk',
    }),
    index('contacts_lead_queue_idx')
      .on(table.tenantId, table.leadStatusId, table.createdAt.desc())
      .where(sql`${table.deletedAt} is null and ${table.leadStatusId} is not null`),
    index('contacts_handover_idx')
      .on(table.tenantId, table.handoverToUserId)
      .where(sql`${table.deletedAt} is null and ${table.handoverToUserId} is not null`),
  ],
);

/** People who belong together: parent and student, a couple buying a home (B2C). */
export const contactLinks = pgTable(
  'contact_links',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    contactId: uuid().notNull(),
    relatedContactId: uuid().notNull(),
    /** How the related person relates to the contact: parent, partner, sibling… */
    relationship: text().notNull(),
    createdBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('contact_links_pair_key').on(table.tenantId, table.contactId, table.relatedContactId),
    index('contact_links_related_idx').on(table.tenantId, table.relatedContactId),
    foreignKey({
      columns: [table.tenantId, table.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
      name: 'contact_links_tenant_contact_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.relatedContactId],
      foreignColumns: [contacts.tenantId, contacts.id],
      name: 'contact_links_tenant_related_fk',
    }).onDelete('cascade'),
  ],
);

export const contactOrganizations = pgTable(
  'contact_organizations',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    contactId: uuid().notNull(),
    organizationId: uuid().notNull(),
    /** Free text in MVP: 'employee', 'student_of', 'guardian_at'… */
    relationship: text().notNull(),
    isPrimary: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('contact_organizations_link_key').on(
      table.tenantId,
      table.contactId,
      table.organizationId,
      table.relationship,
    ),
    index('contact_organizations_org_idx').on(table.tenantId, table.organizationId),
    foreignKey({
      columns: [table.tenantId, table.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
      name: 'contact_organizations_tenant_contact_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizations.tenantId, organizations.id],
      name: 'contact_organizations_tenant_organization_fk',
    }).onDelete('cascade'),
  ],
);
