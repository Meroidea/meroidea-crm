import { sql } from 'drizzle-orm';
import {
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenantMemberships, tenants } from './tenancy';

export const rosterStatus = pgEnum('roster_status', ['draft', 'published']);

/** One rostering period for the workspace: a week or a fortnight of calendar days. */
export const rosters = pgTable(
  'rosters',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** Calendar days in the workspace timezone, both inclusive. */
    startsOn: date({ mode: 'string' }).notNull(),
    endsOn: date({ mode: 'string' }).notNull(),
    status: rosterStatus().notNull().default('draft'),
    publishedAt: timestamp({ withTimezone: true }),
    publishedBy: uuid(),
    /** Set when the worked hours are signed off for pay; shifts are locked from then on. */
    authorisedAt: timestamp({ withTimezone: true }),
    authorisedBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    unique('rosters_tenant_id_id_key').on(table.tenantId, table.id),
    index('rosters_period_idx')
      .on(table.tenantId, table.startsOn)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const rosterShifts = pgTable(
  'roster_shifts',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    rosterId: uuid().notNull(),
    userId: uuid().notNull(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    breakMinutes: integer().notNull().default(0),
    /** A short free-text tag for what the person is doing on the shift; tenant's own words. */
    position: text(),
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index('roster_shifts_roster_idx')
      .on(table.tenantId, table.rosterId)
      .where(sql`${table.deletedAt} is null`),
    index('roster_shifts_person_idx')
      .on(table.tenantId, table.userId, table.startsAt)
      .where(sql`${table.deletedAt} is null`),
    foreignKey({
      columns: [table.tenantId, table.rosterId],
      foreignColumns: [rosters.tenantId, rosters.id],
      name: 'roster_shifts_tenant_roster_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
      name: 'roster_shifts_tenant_person_fk',
    }),
  ],
);
