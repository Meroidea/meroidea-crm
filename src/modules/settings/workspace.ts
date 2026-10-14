import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { auditLogs, tenants } from '@/db/schema';
import { diffChanges } from '@/lib/audit-diff';
import { requirePermission, type TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';

import type { z } from 'zod';
import { readBusinessDetails, type BusinessDetails } from './business';
import type { workspaceSchema } from './schemas';

/**
 * `tenants` is read-only to signed-in users (docs/database.md §11): workspace settings change
 * only here, through the privileged client, after the settings.manage check and scoped to the
 * caller's own tenant id — never one supplied by the browser. The business's name is not among
 * them: only the platform owner changes who a business is (ADR-047).
 */
export async function updateWorkspace(
  ctx: TenantContext,
  input: z.output<typeof workspaceSchema>,
): Promise<{ id: string }> {
  requirePermission(ctx, 'settings.manage');
  const before = {
    timezone: ctx.tenant.timezone,
    currency: ctx.tenant.currency,
    country: ctx.tenant.country,
  };
  const next = {
    timezone: input.timezone,
    currency: input.currency,
    country: input.country,
  };
  const changes = diffChanges(before, next);
  if (Object.keys(changes).length === 0) return { id: ctx.tenantId };

  await adminDb().transaction(async (tx) => {
    await tx
      .update(tenants)
      .set({
        timezone: next.timezone,
        defaultCurrency: next.currency,
        defaultCountry: next.country,
      })
      .where(eq(tenants.id, ctx.tenantId));
    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'update',
      entityType: 'tenant',
      entityId: ctx.tenantId,
      changes,
    });
  });
  return { id: ctx.tenantId };
}

/**
 * Saves how to reach the business. Printed on payslips made from now on; payslips already made
 * keep what they were given.
 */
export async function updateBusinessDetails(
  ctx: TenantContext,
  input: BusinessDetails,
): Promise<{ id: string }> {
  requirePermission(ctx, 'settings.manage');
  const changes = diffChanges(readBusinessDetails(ctx.tenant.settings), input);
  if (Object.keys(changes).length === 0) return { id: ctx.tenantId };

  await adminDb().transaction(async (tx) => {
    await tx
      .update(tenants)
      // Only the business details are replaced; other settings in the same column are kept.
      .set({
        settings: sql`${tenants.settings} || ${JSON.stringify({ business: input })}::jsonb`,
      })
      .where(eq(tenants.id, ctx.tenantId));
    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'update',
      entityType: 'tenant',
      entityId: ctx.tenantId,
      changes,
    });
  });
  return { id: ctx.tenantId };
}
