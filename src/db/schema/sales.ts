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

import { contacts, leadSources, leadSubSources, leadType, organizations } from './crm';
import { teams, tenantMemberships, tenants } from './tenancy';

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
    /** Converted B2B or B2C leads start here; null means any. */
    leadType: leadType(),
    /** Opportunity pipelines only: the item pipeline their items use; null means the default. */
    itemPipelineId: uuid(),
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
    foreignKey({
      columns: [table.tenantId, table.itemPipelineId],
      foreignColumns: [table.tenantId, table.id],
      name: 'pipelines_tenant_item_pipeline_fk',
    }),
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
    /** Who is responsible for opportunities in this stage: a person, or a team in turn. */
    ownerUserId: uuid(),
    ownerTeamId: uuid(),
    /** notify: tell the stage owner. reassign: make them the owner. task: give them a task. */
    onEnter: text().notNull().default('notify'),
    /** The team member last given an opportunity here, so a team takes them in turn. */
    lastAssignedUserId: uuid(),
    /** Fields that must be filled before an opportunity may enter this stage. */
    requiredFields: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Things to tick off in this stage before moving forward: [{ id, label }]. */
    checklist: jsonb().notNull().default([]),
    /** Entering this stage needs a manager's approval. */
    requiresApproval: boolean().notNull().default(false),
    /** Item stages only: an item entering it moves its opportunity forward to this stage. */
    advancesParentToStageId: uuid(),
    ...timestamps,
  },
  (table) => [
    unique('pipeline_stages_tenant_id_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.ownerUserId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
      name: 'pipeline_stages_tenant_owner_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.ownerTeamId],
      foreignColumns: [teams.tenantId, teams.id],
      name: 'pipeline_stages_tenant_team_fk',
    }),
    index('pipeline_stages_pipeline_idx').on(table.tenantId, table.pipelineId, table.position),
    foreignKey({
      columns: [table.tenantId, table.pipelineId],
      foreignColumns: [pipelines.tenantId, pipelines.id],
      name: 'pipeline_stages_tenant_pipeline_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.advancesParentToStageId],
      foreignColumns: [table.tenantId, table.id],
      name: 'pipeline_stages_tenant_advances_parent_fk',
    }),
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
    subSourceId: uuid(),
    /** The SDR/BDR whose lead this came from, carried over on conversion. */
    originatorUserId: uuid(),
    partnerId: uuid(),
    partnerReference: text(),
    /** The product or service being sold, in the business's words. */
    product: text(),
    /** Overrides the stage's probability when set. */
    probability: smallint(),
    nextStep: text(),
    /** Ticked checklist items by stage: { [stageId]: [itemId] }. */
    checklistState: jsonb().notNull().default({}),
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
    foreignKey({
      columns: [table.tenantId, table.subSourceId],
      foreignColumns: [leadSubSources.tenantId, leadSubSources.id],
      name: 'opportunities_tenant_sub_source_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.originatorUserId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
      name: 'opportunities_tenant_originator_fk',
    }),
  ],
);

/** Further people on an opportunity besides its primary contact, each with a role. */
export const opportunityContacts = pgTable(
  'opportunity_contacts',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    opportunityId: uuid().notNull(),
    contactId: uuid().notNull(),
    role: text().notNull(),
    createdBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('opportunity_contacts_key').on(table.tenantId, table.opportunityId, table.contactId),
    index('opportunity_contacts_contact_idx').on(table.tenantId, table.contactId),
    foreignKey({
      columns: [table.tenantId, table.opportunityId],
      foreignColumns: [opportunities.tenantId, opportunities.id],
      name: 'opportunity_contacts_tenant_opportunity_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
      name: 'opportunity_contacts_tenant_contact_fk',
    }).onDelete('cascade'),
  ],
);

/** A request to move an opportunity into a stage that needs a manager's approval. */
export const stageApprovals = pgTable(
  'stage_approvals',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    opportunityId: uuid().notNull(),
    stageId: uuid().notNull(),
    /** pending | approved | declined | withdrawn */
    status: text().notNull().default('pending'),
    note: text(),
    requestedBy: uuid().notNull(),
    requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid(),
    decidedAt: timestamp({ withTimezone: true }),
    decisionNote: text(),
  },
  (table) => [
    unique('stage_approvals_tenant_id_id_key').on(table.tenantId, table.id),
    index('stage_approvals_pending_idx')
      .on(table.tenantId, table.status, table.requestedAt)
      .where(sql`${table.status} = 'pending'`),
    foreignKey({
      columns: [table.tenantId, table.opportunityId],
      foreignColumns: [opportunities.tenantId, opportunities.id],
      name: 'stage_approvals_tenant_opportunity_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.stageId],
      foreignColumns: [pipelineStages.tenantId, pipelineStages.id],
      name: 'stage_approvals_tenant_stage_fk',
    }),
  ],
);

/**
 * One thing pursued inside an opportunity, with its own stage track and value (ADR-018): an
 * application to one institution, an offer on one property. Access follows the opportunity.
 */
export const opportunityItems = pgTable(
  'opportunity_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    opportunityId: uuid().notNull(),
    /** The counterparty: the institution, the vendor, the employer. */
    organizationId: uuid().notNull(),
    title: text().notNull(),
    pipelineId: uuid().notNull(),
    stageId: uuid().notNull(),
    status: opportunityStatus().notNull().default('open'),
    stageEnteredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp({ withTimezone: true }),
    lostReasonId: uuid(),
    lostReasonNote: text(),
    /** The counterparty's own reference, e.g. an application or student number. */
    externalReference: text(),
    /** What the item's revenue is worked out from, e.g. a tuition fee. */
    baseAmount: numeric({ precision: 14, scale: 2 }),
    /** Percentage of the base amount, e.g. a commission rate of 15.0000. */
    revenueRate: numeric({ precision: 7, scale: 4 }),
    /** Defaults to base × rate / 100; editable for bonuses and flat fees. */
    expectedRevenue: numeric({ precision: 14, scale: 2 }),
    currency: char({ length: 3 }),
    ownerUserId: uuid(),
    customFields: jsonb().notNull().default({}),
    /** The customer's order of preference. */
    position: integer().notNull().default(0),
    ...timestamps,
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    unique('opportunity_items_tenant_id_id_key').on(table.tenantId, table.id),
    index('opportunity_items_opportunity_idx')
      .on(table.tenantId, table.opportunityId)
      .where(sql`${table.deletedAt} is null`),
    index('opportunity_items_organization_idx').on(
      table.tenantId,
      table.organizationId,
      table.status,
    ),
    index('opportunity_items_stage_idx')
      .on(table.tenantId, table.pipelineId, table.stageId)
      .where(sql`${table.deletedAt} is null`),
    foreignKey({
      columns: [table.tenantId, table.opportunityId],
      foreignColumns: [opportunities.tenantId, opportunities.id],
      name: 'opportunity_items_tenant_opportunity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizations.tenantId, organizations.id],
      name: 'opportunity_items_tenant_organization_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.pipelineId],
      foreignColumns: [pipelines.tenantId, pipelines.id],
      name: 'opportunity_items_tenant_pipeline_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stageId],
      foreignColumns: [pipelineStages.tenantId, pipelineStages.id],
      name: 'opportunity_items_tenant_stage_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.lostReasonId],
      foreignColumns: [lostReasons.tenantId, lostReasons.id],
      name: 'opportunity_items_tenant_lost_reason_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.ownerUserId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
      name: 'opportunity_items_tenant_owner_fk',
    }),
  ],
);

/**
 * One row per visit to a stage, by an opportunity (item id null) or one of its items; written
 * only by moveStage() and moveItemStage(), in the same transaction.
 */
export const stageHistory = pgTable(
  'stage_history',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    opportunityId: uuid().notNull(),
    opportunityItemId: uuid(),
    stageId: uuid().notNull(),
    enteredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    exitedAt: timestamp({ withTimezone: true }),
    enteredBy: uuid(),
  },
  (table) => [
    index('stage_history_opportunity_idx').on(table.tenantId, table.opportunityId, table.enteredAt),
    index('stage_history_stage_idx').on(table.tenantId, table.stageId, table.enteredAt),
    index('stage_history_item_idx')
      .on(table.tenantId, table.opportunityItemId, table.enteredAt)
      .where(sql`${table.opportunityItemId} is not null`),
    foreignKey({
      columns: [table.tenantId, table.opportunityItemId],
      foreignColumns: [opportunityItems.tenantId, opportunityItems.id],
      name: 'stage_history_tenant_item_fk',
    }).onDelete('cascade'),
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
