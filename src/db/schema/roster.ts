import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
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

/**
 * A named, coloured group people are rostered into: an area, a duty, a level — whatever the
 * business calls it. A person can only be given a shift in a team they belong to.
 */
export const rosterTeams = pgTable(
  'roster_teams',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    /** A colour token from the design system (chart-1 … chart-5), never a raw colour. */
    color: text().notNull().default('chart-3'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [unique('roster_teams_tenant_id_id_key').on(table.tenantId, table.id)],
);

export const rosterTeamMembers = pgTable(
  'roster_team_members',
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    teamId: uuid().notNull(),
    userId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId] }),
    index('roster_team_members_person_idx').on(table.tenantId, table.userId),
    foreignKey({
      columns: [table.tenantId, table.teamId],
      foreignColumns: [rosterTeams.tenantId, rosterTeams.id],
      name: 'roster_team_members_tenant_team_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
      name: 'roster_team_members_tenant_person_fk',
    }),
  ],
);

/** One break inside a shift. Unpaid breaks come off the hours worked; paid ones do not. */
export type ShiftBreak = { minutes: number; paid: boolean };

export const rosterShifts = pgTable(
  'roster_shifts',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    rosterId: uuid().notNull(),
    /** Null while the shift is vacant: planned, but nobody is on it yet. */
    userId: uuid(),
    teamId: uuid(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    /** Unpaid break time, the sum of the unpaid entries in `breaks`. */
    breakMinutes: integer().notNull().default(0),
    breaks: jsonb().$type<ShiftBreak[]>().notNull().default([]),
    /** True while the breaks follow the workspace's break rules rather than being typed in. */
    autoBreaks: boolean().notNull().default(false),
    note: text(),
    /** When staff were last shown this shift. Null means it has never been published. */
    publishedAt: timestamp({ withTimezone: true }),
    /** True when the shift was added, changed or removed since it was last published. */
    unpublishedChanges: boolean().notNull().default(true),
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
    foreignKey({
      columns: [table.tenantId, table.teamId],
      foreignColumns: [rosterTeams.tenantId, rosterTeams.id],
      name: 'roster_shifts_tenant_team_fk',
    }),
  ],
);

/** A break the roster adds by itself to a shift at least `fromMinutes` long. */
export type BreakRule = { fromMinutes: number; minutes: number; paid: boolean };

/**
 * How a business costs and fills its shifts: what a Saturday, Sunday or public holiday pays
 * relative to an ordinary day, and which breaks a shift of a given length gets. One row per
 * workspace, created the first time the rules are saved; absent means ordinary rates.
 */
export const workforceSettings = pgTable('workforce_settings', {
  tenantId: uuid()
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  /** Multipliers of the contract hourly rate: 1 is ordinary pay, 1.5 is time and a half. */
  saturdayLoading: numeric({ precision: 4, scale: 2 }).notNull().default('1'),
  sundayLoading: numeric({ precision: 4, scale: 2 }).notNull().default('1'),
  publicHolidayLoading: numeric({ precision: 4, scale: 2 }).notNull().default('1'),
  breakRules: jsonb().$type<BreakRule[]>().notNull().default([]),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid(),
  updatedBy: uuid(),
});

/** A day the business pays at its public holiday loading. Each business keeps its own list. */
export const publicHolidays = pgTable(
  'public_holidays',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** A calendar day in the workspace timezone. */
    day: date({ mode: 'string' }).notNull(),
    name: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
  },
  (table) => [unique('public_holidays_tenant_id_day_key').on(table.tenantId, table.day)],
);
