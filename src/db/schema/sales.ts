import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { contacts, leadSources, organizations } from './crm';
import { tenantMemberships, tenants } from './tenancy';

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

export const pipelineObject = pgEnum('pipeline_object', ['opportunity', 'opportunity_item']);
export const stageCategory = pgEnum('stage_category', ['open', 'won', 'lost']);
export const opportunityStatus = pgEnum('opportunity_status', ['open', 'won', 'lost']);
export const partnerStatus = pgEnum('partner_status', ['prospect', 'active', 'inactive']);
export const commissionType = pgEnum('commission_type', ['none', 'percentage', 'fixed']);
export const commissionBasis = pgEnum('commission_basis', [
  'item_revenue',
  'direct_revenue',
  'both',
  'per_won_item',
]);

export const pipelines = pgTable(
  'pipelines',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    description: text(),
    objectType: pipelineObject().notNull().default('opportunity'),
    isDefault: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    position: integer().notNull().default(0),
    ...timestamps,
  },
  (table) => [
    unique('pipelines_tenant_id_id_key').on(table.tenantId, table.id),
    index('pipelines_one_default_idx')
      .on(table.tenantId, table.objectType)
      .where(sql`${table.isDefault}`),
  ],
);

export const pipelineStages = pgTable(
  'pipeline_stages',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    pipelineId: uuid().notNull(),
    name: text().notNull(),
    position: integer().notNull(),
    category: stageCategory().notNull().default('open'),
    probability: smallint(),
    color: text(),
    staleAfterDays: integer(),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique('pipeline_stages_tenant_id_id_key').on(table.tenantId, table.id),
    index('pipeline_stages_pipeline_idx').on(table.tenantId, table.pipelineId, table.position),
    foreignKey({
      columns: [table.tenantId, table.pipelineId],
      foreignColumns: [pipelines.tenantId, pipelines.id],
      name: 'pipeline_stages_tenant_pipeline_fk',
    }).onDelete('cascade'),
  ],
);

export const lostReasons = pgTable(
  'lost_reasons',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    isActive: boolean().notNull().default(true),
    position: integer().notNull().default(0),
    ...timestamps,
  },
  (table) => [
    unique('lost_reasons_tenant_id_id_key').on(table.tenantId, table.id),
    unique('lost_reasons_tenant_id_name_key').on(table.tenantId, table.name),
  ],
);

export const partners = pgTable(
  'partners',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    organizationId: uuid().notNull(),
    status: partnerStatus().notNull().default('active'),
    commissionType: commissionType().notNull().default('none'),
    commissionBasis: commissionBasis(),
    commissionValue: numeric({ precision: 14, scale: 2 }),
    currency: char({ length: 3 }),
    agreementStart: date(),
    agreementEnd: date(),
    primaryContactId: uuid(),
    notes: text(),
    customFields: jsonb().notNull().default({}),
    ...timestamps,
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    unique('partners_tenant_id_id_key').on(table.tenantId, table.id),
    unique('partners_tenant_id_organization_id_key').on(table.tenantId, table.organizationId),
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizations.tenantId, organizations.id],
      name: 'partners_tenant_organization_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.primaryContactId],
      foreignColumns: [contacts.tenantId, contacts.id],
      name: 'partners_tenant_primary_contact_fk',
    }),
  ],
);

export const opportunities = pgTable(
  'opportunities',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    contactId: uuid().notNull(),
    organizationId: uuid(),
    name: text().notNull(),
    pipelineId: uuid().notNull(),
    stageId: uuid().notNull(),
    status: opportunityStatus().notNull().default('open'),
    ownerUserId: uuid(),
    sourceId: uuid(),
    partnerId: uuid(),
    partnerReference: text(),
    amount: numeric({ precision: 14, scale: 2 }),
    currency: char({ length: 3 }),
    expectedCloseDate: date(),
    stageEnteredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp({ withTimezone: true }),
    lostReasonId: uuid(),
    lostReasonNote: text(),
    lastActivityAt: timestamp({ withTimezone: true }),
    nextTaskDueAt: timestamp({ withTimezone: true }),
    customFields: jsonb().notNull().default({}),
    ...timestamps,
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    unique('opportunities_tenant_id_id_key').on(table.tenantId, table.id),
    index('opportunities_board_idx')
      .on(table.tenantId, table.pipelineId, table.stageId)
      .where(sql`${table.deletedAt} is null`),
    index('opportunities_owner_idx')
      .on(table.tenantId, table.ownerUserId, table.status)
      .where(sql`${table.deletedAt} is null`),
    index('opportunities_partner_idx')
      .on(table.tenantId, table.partnerId)
      .where(sql`${table.partnerId} is not null`),
    index('opportunities_source_idx').on(table.tenantId, table.sourceId, table.createdAt),
    index('opportunities_stale_idx').on(table.tenantId, table.status, table.lastActivityAt),
    index('opportunities_contact_idx').on(table.tenantId, table.contactId),
    foreignKey({
      columns: [table.tenantId, table.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
      name: 'opportunities_tenant_contact_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizations.tenantId, organizations.id],
      name: 'opportunities_tenant_organization_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.pipelineId],
      foreignColumns: [pipelines.tenantId, pipelines.id],
      name: 'opportunities_tenant_pipeline_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stageId],
      foreignColumns: [pipelineStages.tenantId, pipelineStages.id],
      name: 'opportunities_tenant_stage_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.ownerUserId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
      name: 'opportunities_tenant_owner_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.sourceId],
      foreignColumns: [leadSources.tenantId, leadSources.id],
      name: 'opportunities_tenant_source_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.partnerId],
      foreignColumns: [partners.tenantId, partners.id],
      name: 'opportunities_tenant_partner_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.lostReasonId],
      foreignColumns: [lostReasons.tenantId, lostReasons.id],
      name: 'opportunities_tenant_lost_reason_fk',
    }),
  ],
);

/** One row per visit to a stage; written only by moveStage(), in the same transaction. */
export const stageHistory = pgTable(
  'stage_history',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    opportunityId: uuid().notNull(),
    stageId: uuid().notNull(),
    enteredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    exitedAt: timestamp({ withTimezone: true }),
    enteredBy: uuid(),
  },
  (table) => [
    index('stage_history_opportunity_idx').on(table.tenantId, table.opportunityId, table.enteredAt),
    index('stage_history_stage_idx').on(table.tenantId, table.stageId, table.enteredAt),
    foreignKey({
      columns: [table.tenantId, table.opportunityId],
      foreignColumns: [opportunities.tenantId, opportunities.id],
      name: 'stage_history_tenant_opportunity_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.stageId],
      foreignColumns: [pipelineStages.tenantId, pipelineStages.id],
      name: 'stage_history_tenant_stage_fk',
    }),
  ],
);
