import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const tenantStatus = pgEnum('tenant_status', [
  'trialing',
  'active',
  'past_due',
  'suspended',
  'cancelled',
]);

export const membershipStatus = pgEnum('membership_status', ['invited', 'active', 'deactivated']);

export const permissionScope = pgEnum('permission_scope', ['own', 'team', 'all']);

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

/** The company. Not tenant-owned — it *is* the tenant. */
export const tenants = pgTable('tenants', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  status: tenantStatus().notNull().default('trialing'),
  industry: text(),
  templateCode: text(),
  onboarding: jsonb().notNull().default({}),
  logoPath: text(),
  primaryColor: text(),
  timezone: text().notNull().default('UTC'),
  defaultCurrency: char({ length: 3 }).notNull().default('USD'),
  defaultCountry: char({ length: 2 }),
  locale: text().notNull().default('en'),
  labels: jsonb().notNull().default({}),
  settings: jsonb().notNull().default({}),
  /** Feature keys switched on for this business by the platform owner (src/lib/features.ts). */
  features: text()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  /**
   * Where the business is, set by the platform owner. When present, staff can only clock in and
   * out within `clockRadiusMetres` of it.
   */
  locationLatitude: numeric({ precision: 9, scale: 6 }),
  locationLongitude: numeric({ precision: 9, scale: 6 }),
  clockRadiusMetres: integer().notNull().default(10),
  ...timestamps,
});

/**
 * Global profile, one per auth.users row. Deliberately not tenant-owned: one person can belong
 * to several workspaces (ADR-004). The FK to auth.users is added in a custom migration.
 */
export const users = pgTable('users', {
  id: uuid().primaryKey(),
  email: text().notNull(),
  fullName: text().notNull(),
  avatarPath: text(),
  phone: text(),
  ...timestamps,
});

export const teams = pgTable(
  'teams',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    managerUserId: uuid(),
    ...timestamps,
  },
  (table) => [
    unique('teams_tenant_id_id_key').on(table.tenantId, table.id),
    unique('teams_tenant_id_name_key').on(table.tenantId, table.name),
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** Stable identifier used by seeds and tests: owner, manager, member, support. */
    key: text().notNull(),
    name: text().notNull(),
    description: text(),
    isSystem: boolean().notNull().default(false),
    ...timestamps,
  },
  (table) => [
    unique('roles_tenant_id_id_key').on(table.tenantId, table.id),
    unique('roles_tenant_id_key_key').on(table.tenantId, table.key),
  ],
);

/** Grants only. The permission catalog itself lives in code (ADR-004). */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    tenantId: uuid().notNull(),
    roleId: uuid().notNull(),
    permission: text().notNull(),
    scope: permissionScope(),
  },
  (table) => [
    unique('role_permissions_role_id_permission_key').on(table.roleId, table.permission),
    foreignKey({
      columns: [table.tenantId, table.roleId],
      foreignColumns: [roles.tenantId, roles.id],
      name: 'role_permissions_tenant_role_fk',
    }).onDelete('cascade'),
  ],
);

/** A user's seat in one tenant, carrying their role and team. */
export const tenantMemberships = pgTable(
  'tenant_memberships',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    roleId: uuid().notNull(),
    teamId: uuid(),
    status: membershipStatus().notNull().default('invited'),
    jobTitle: text(),
    invitedBy: uuid(),
    lastSeenAt: timestamp({ withTimezone: true }),
    /** A platform owner's temporary seat while giving support; removed when they leave. */
    isSupport: boolean().notNull().default(false),
    ...timestamps,
  },
  (table) => [
    unique('tenant_memberships_tenant_id_user_id_key').on(table.tenantId, table.userId),
    index('tenant_memberships_user_id_idx').on(table.userId),
    foreignKey({
      columns: [table.tenantId, table.roleId],
      foreignColumns: [roles.tenantId, roles.id],
      name: 'tenant_memberships_tenant_role_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.teamId],
      foreignColumns: [teams.tenantId, teams.id],
      name: 'tenant_memberships_tenant_team_fk',
    }),
  ],
);

/** Billing state; Stripe stays the source of truth (ADR-024). */
export const tenantSubscriptions = pgTable('tenant_subscriptions', {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: uuid()
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  planCode: text().notNull().default('trial'),
  status: text().notNull().default('trialing'),
  seats: integer().notNull().default(1),
  stripeCustomerId: text(),
  stripeSubscriptionId: text(),
  trialEndsAt: timestamp({ withTimezone: true }),
  currentPeriodEnd: timestamp({ withTimezone: true }),
  cancelAt: timestamp({ withTimezone: true }),
  canceledAt: timestamp({ withTimezone: true }),
  ...timestamps,
});
