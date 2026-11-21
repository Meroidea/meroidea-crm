import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { tenantMemberships, tenants } from './tenancy';

/**
 * A change Meroidea AI has proposed and nobody has approved yet (ADR-064). The assistant never
 * writes business records itself: its write tools only add a row here, the person sees it as a
 * card in the chat, and nothing happens until they approve it. Approval then runs the module's
 * own service as that person, so the change gets the same permission checks, business rules and
 * audit rows as if they had made it on the screen. Only the person who asked can see, edit,
 * approve or reject their proposals (RLS), and a decided proposal can never be decided again
 * (trigger).
 */
export const aiPendingActions = pgTable(
  'ai_pending_actions',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** Who asked the assistant; the only person who may decide it. */
    createdBy: uuid().notNull(),
    /** invoice | roster | staff_email | record_update */
    kind: text().notNull(),
    /** The validated input for the module service, in the shape its schema expects. */
    payload: jsonb().notNull(),
    /** One line for lists and the conversation: "Draft invoice for Example Pty Ltd, 3 lines". */
    summary: text().notNull(),
    /** pending → executing → approved | failed; pending → rejected | expired. */
    status: text().notNull().default('pending'),
    /** What approval produced, e.g. `{ entityType: 'invoice', entityId, href }`. */
    result: jsonb(),
    /** The reason the last approval did not go through, safe to show the person. */
    error: text(),
    decidedBy: uuid(),
    decidedAt: timestamp({ withTimezone: true }),
    /** Unapproved proposals lapse, so an old card cannot act on a changed business. */
    expiresAt: timestamp({ withTimezone: true })
      .notNull()
      .default(sql`now() + interval '24 hours'`),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('ai_pending_actions_tenant_id_id_key').on(table.tenantId, table.id),
    index('ai_pending_actions_tenant_creator_idx').on(
      table.tenantId,
      table.createdBy,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
      name: 'ai_pending_actions_creator_fk',
    }).onDelete('restrict'),
    check(
      'ai_pending_actions_kind_check',
      sql`${table.kind} in ('invoice', 'roster', 'staff_email', 'record_update')`,
    ),
    check(
      'ai_pending_actions_status_check',
      sql`${table.status} in ('pending', 'executing', 'approved', 'rejected', 'failed', 'expired')`,
    ),
  ],
);
