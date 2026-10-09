import { sql } from 'drizzle-orm';
import {
  date,
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

/** A piece of work with an end: a fit-out, an event, a client engagement. */
export const projects = pgTable(
  'projects',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    description: text(),
    /** active | on_hold | completed */
    status: text().notNull().default('active'),
    startsOn: date({ mode: 'string' }),
    dueOn: date({ mode: 'string' }),
    /** The person responsible for the project. */
    leadUserId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    unique('projects_tenant_id_id_key').on(table.tenantId, table.id),
    index('projects_list_idx')
      .on(table.tenantId, table.status)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/** One thing to do inside a project. Separate from CRM follow-up tasks (`tasks`). */
export const projectTasks = pgTable(
  'project_tasks',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    projectId: uuid().notNull(),
    title: text().notNull(),
    description: text(),
    /** todo → in_progress → review → done */
    status: text().notNull().default('todo'),
    /** low | normal | high */
    priority: text().notNull().default('normal'),
    assigneeUserId: uuid(),
    dueOn: date({ mode: 'string' }),
    /** How long it is expected to take, for comparing with the time logged. */
    estimateMinutes: integer(),
    completedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    unique('project_tasks_tenant_id_id_key').on(table.tenantId, table.id),
    foreignKey({
      name: 'project_tasks_project_fkey',
      columns: [table.tenantId, table.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }).onDelete('restrict'),
    index('project_tasks_board_idx')
      .on(table.tenantId, table.projectId, table.status)
      .where(sql`${table.deletedAt} is null`),
    index('project_tasks_assignee_idx')
      .on(table.tenantId, table.assigneeUserId, table.status)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/** Time a person spent on a task: a running timer, or minutes typed in afterwards. */
export const taskTimeLogs = pgTable(
  'task_time_logs',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    projectTaskId: uuid().notNull(),
    userId: uuid().notNull(),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    /** Null while the timer is running. */
    endedAt: timestamp({ withTimezone: true }),
    /** Set when the timer stops, or typed in for a manual log. */
    minutes: integer(),
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'task_time_logs_task_fkey',
      columns: [table.tenantId, table.projectTaskId],
      foreignColumns: [projectTasks.tenantId, projectTasks.id],
    }).onDelete('cascade'),
    index('task_time_logs_task_idx').on(table.tenantId, table.projectTaskId),
    index('task_time_logs_person_idx').on(table.tenantId, table.userId, table.startedAt),
    // One running timer per person.
    uniqueIndex('task_time_logs_one_running_key')
      .on(table.tenantId, table.userId)
      .where(sql`${table.endedAt} is null`),
  ],
);
