import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenants } from './tenancy';

/** The kinds of leave a business offers. Each business names its own. */
export const leaveTypes = pgTable(
  'leave_types',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    isPaid: boolean().notNull().default(true),
    isActive: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
  },
  (table) => [
    unique('leave_types_tenant_id_id_key').on(table.tenantId, table.id),
    unique('leave_types_tenant_id_name_key').on(table.tenantId, table.name),
  ],
);

/** One person's request for time away, and what was decided about it. */
export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** The person taking the leave. */
    userId: uuid().notNull(),
    leaveTypeId: uuid().notNull(),
    startsOn: date({ mode: 'string' }).notNull(),
    endsOn: date({ mode: 'string' }).notNull(),
    /** Working days away, as entered by the person; half days allowed. */
    days: numeric({ precision: 5, scale: 2 }).notNull(),
    note: text(),
    /** pending → approved | declined, or cancelled by the person or a manager. */
    status: text().notNull().default('pending'),
    decidedBy: uuid(),
    decidedAt: timestamp({ withTimezone: true }),
    decisionNote: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
  },
  (table) => [
    foreignKey({
      name: 'leave_requests_leave_type_fkey',
      columns: [table.tenantId, table.leaveTypeId],
      foreignColumns: [leaveTypes.tenantId, leaveTypes.id],
    }).onDelete('restrict'),
    index('leave_requests_person_idx').on(table.tenantId, table.userId, table.startsOn),
    index('leave_requests_waiting_idx')
      .on(table.tenantId, table.startsOn)
      .where(sql`${table.status} = 'pending'`),
  ],
);
