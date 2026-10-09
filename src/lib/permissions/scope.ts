import { eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import { AppError } from '@/lib/errors';

import type { Grant, PermissionKey } from './catalog';

/** The slice of TenantContext that scope decisions need; keeps this module free of server code. */
export type ScopeContext = {
  userId: string;
  grants: Map<PermissionKey, Grant>;
  teamUserIds: string[];
  tenant: { settings: Record<string, unknown> };
};

export type ScopeDecision =
  | { kind: 'none' }
  | { kind: 'all' }
  | { kind: 'owners'; userIds: string[]; includeUnassigned: boolean };

/**
 * The one place record scope is interpreted (docs/permissions.md). Lists turn it into SQL with
 * scopeFilter(); single records are checked with assertCanAccess().
 */
export function scopeDecision(ctx: ScopeContext, key: PermissionKey): ScopeDecision {
  const grant = ctx.grants.get(key);
  if (grant === undefined) return { kind: 'none' };
  if (grant === true || grant === 'all') return { kind: 'all' };

  // A shared "claim a lead" queue: unassigned records stay visible to narrower scopes.
  const includeUnassigned = ctx.tenant.settings.consultantCanSeeUnassigned === true;
  const userIds = grant === 'own' ? [ctx.userId] : [...new Set([ctx.userId, ...ctx.teamUserIds])];
  return { kind: 'owners', userIds, includeUnassigned };
}

export function scopeFilter(
  ctx: ScopeContext,
  key: PermissionKey,
  table: { ownerUserId: PgColumn },
): SQL | undefined {
  const decision = scopeDecision(ctx, key);
  if (decision.kind === 'all') return undefined;
  if (decision.kind === 'none') return sql`false`;

  const owned =
    decision.userIds.length === 1 && decision.userIds[0]
      ? eq(table.ownerUserId, decision.userIds[0])
      : inArray(table.ownerUserId, decision.userIds);
  return decision.includeUnassigned ? or(owned, isNull(table.ownerUserId)) : owned;
}

export function canAccess(
  ctx: ScopeContext,
  key: PermissionKey,
  record: { ownerUserId: string | null },
): boolean {
  const decision = scopeDecision(ctx, key);
  if (decision.kind === 'all') return true;
  if (decision.kind === 'none') return false;
  if (record.ownerUserId === null) return decision.includeUnassigned;
  return decision.userIds.includes(record.ownerUserId);
}

/** NOT_FOUND rather than FORBIDDEN: a record outside scope must not reveal that it exists. */
export function assertCanAccess(
  ctx: ScopeContext,
  key: PermissionKey,
  record: { ownerUserId: string | null },
): void {
  if (!canAccess(ctx, key, record)) throw new AppError('NOT_FOUND', 'That record was not found.');
}
