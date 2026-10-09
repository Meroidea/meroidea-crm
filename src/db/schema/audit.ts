import { bigint, index, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenancy';

/** Append-only. UPDATE and DELETE are revoked from `authenticated` in a custom migration. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    actorUserId: uuid(),
    actorType: text().notNull().default('user'),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid(),
    changes: jsonb(),
    context: jsonb(),
    ip: inet(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_tenant_entity_idx').on(table.tenantId, table.entityType, table.entityId),
    index('audit_logs_tenant_actor_idx').on(table.tenantId, table.actorUserId),
    index('audit_logs_tenant_created_idx').on(table.tenantId, table.createdAt),
  ],
);
