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
