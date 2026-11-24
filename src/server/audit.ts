import 'server-only';

import { auditLogs } from '@/db/schema';
import type { Tx } from '@/server/db/with-rls';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'restore'
  | 'stage_change'
  | 'owner_change'
  | 'export'
  | 'import'
  | 'download'
  | 'view_sensitive'
  | 'permission_change'
  | 'login'
  /** A request to the AI assistant: which tool and model, never what was asked (ADR-074). */
  | 'ai_assist'
  /** A person approved something the AI assistant drafted, and it was saved. */
  | 'ai_approve';

export type AuditEntry = {
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  changes?: Record<string, [unknown, unknown]> | null;
  context?: Record<string, unknown> | null;
};

/** Always called inside the same transaction as the change it records (rules/security.md). */
export async function audit(
  tx: Tx,
  ctx: { tenantId: string; userId: string },
  entry: AuditEntry,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    actorType: 'user',
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    changes: entry.changes ?? null,
    context: entry.context ?? null,
  });
}
