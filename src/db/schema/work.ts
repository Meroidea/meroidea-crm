import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { contacts, organizations } from './crm';
import { opportunities } from './sales';
import { tenantMemberships, tenants } from './tenancy';

export const activityType = pgEnum('activity_type', [
  'call',
  'email',
  'meeting',
  'message',
  'note',
  'stage_changed',
  'owner_changed',
  'created',
  'task_completed',
  'imported',
]);
export const activityDirection = pgEnum('activity_direction', ['inbound', 'outbound']);
export const taskType = pgEnum('task_type', [
  'call',
  'email',
  'meeting',
  'follow_up',
  'document',
  'other',
]);
export const taskStatus = pgEnum('task_status', ['open', 'completed', 'cancelled']);
export const taskPriority = pgEnum('task_priority', ['low', 'normal', 'high']);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    title: text().notNull(),
    description: text(),
    type: taskType().notNull().default('follow_up'),
    status: taskStatus().notNull().default('open'),
    priority: taskPriority().notNull().default('normal'),
    dueAt: timestamp({ withTimezone: true }),
    remindAt: timestamp({ withTimezone: true }),
    assignedTo: uuid().notNull(),
    contactId: uuid(),
    opportunityId: uuid(),
    completedAt: timestamp({ withTimezone: true }),
    completedBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index('tasks_my_day_idx')
      .on(table.tenantId, table.assignedTo, table.status, table.dueAt)
      .where(sql`${table.deletedAt} is null`),
    index('tasks_opportunity_idx')
      .on(table.tenantId, table.opportunityId)
      .where(sql`${table.status} = 'open'`),
    index('tasks_contact_idx').on(table.tenantId, table.contactId),
    foreignKey({
      columns: [table.tenantId, table.assignedTo],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
      name: 'tasks_tenant_assignee_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
      name: 'tasks_tenant_contact_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.opportunityId],
      foreignColumns: [opportunities.tenantId, opportunities.id],
      name: 'tasks_tenant_opportunity_fk',
    }),
  ],
);

export const activities = pgTable(
  'activities',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    type: activityType().notNull(),
    channel: text(),
    direction: activityDirection(),
    subject: text(),
    body: text(),
    outcome: text(),
    durationSeconds: integer(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    contactId: uuid(),
    opportunityId: uuid(),
    organizationId: uuid(),
    taskId: uuid(),
    actorUserId: uuid(),
    metadata: jsonb().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index('activities_contact_idx').on(table.tenantId, table.contactId, table.occurredAt.desc()),
    index('activities_opportunity_idx').on(
      table.tenantId,
      table.opportunityId,
      table.occurredAt.desc(),
    ),
    index('activities_actor_idx').on(table.tenantId, table.actorUserId, table.occurredAt.desc()),
    foreignKey({
      columns: [table.tenantId, table.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
      name: 'activities_tenant_contact_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.opportunityId],
      foreignColumns: [opportunities.tenantId, opportunities.id],
      name: 'activities_tenant_opportunity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [organizations.tenantId, organizations.id],
      name: 'activities_tenant_organization_fk',
    }),
  ],
);
