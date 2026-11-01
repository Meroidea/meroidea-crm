import 'server-only';

import { eq, sql, type SQL } from 'drizzle-orm';

import { tenants } from '@/db/schema';
import { diffChanges } from '@/lib/audit-diff';
import { AppError } from '@/lib/errors';
import type { Labels } from '@/lib/tenant/labels';
import { readCrmSettings, type CrmSettings } from '@/modules/leads/settings';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { z } from 'zod';
import { readBusinessDetails, type BusinessDetails } from './business';
import type { workspaceSchema } from './schemas';

type TenantUpdate = {
  timezone?: string;
  defaultCurrency?: string;
  defaultCountry?: string | null;
  settings?: SQL;
  labels?: Labels;
};

/**
 * Writes the caller's own workspace row with its audit entry, under row-level security: the
 * database allows only someone with settings.manage in the active business, and only the
 * settings columns (migration 0067, ADR-059). Who the business is stays with the platform
 * console (ADR-047). Nothing written means the database refused, e.g. a login switched off
 * since the request began.
 */
async function updateOwnTenant(
  ctx: TenantContext,
  values: TenantUpdate,
  changes: Record<string, [unknown, unknown]>,
): Promise<void> {
  await withRls(ctx, async (tx) => {
    const [updated] = await tx
      .update(tenants)
      .set(values)
      .where(eq(tenants.id, ctx.tenantId))
      .returning({ id: tenants.id });
    if (!updated) throw new AppError('FORBIDDEN', 'You can’t change this workspace’s settings.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'tenant',
      entityId: ctx.tenantId,
      changes,
    });
  });
}

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

  await updateOwnTenant(
    ctx,
    { timezone: next.timezone, defaultCurrency: next.currency, defaultCountry: next.country },
    changes,
  );
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

  // Only the business details are replaced; other settings in the same column are kept.
  await updateOwnTenant(
    ctx,
    { settings: sql`${tenants.settings} || ${JSON.stringify({ business: input })}::jsonb` },
    changes,
  );
  return { id: ctx.tenantId };
}

/** Replaces one key of `tenants.settings`, audited, keeping every other setting as it was. */
async function saveSettingsKey(
  ctx: TenantContext,
  key: string,
  value: unknown,
  changes: Record<string, [unknown, unknown]>,
): Promise<void> {
  await updateOwnTenant(
    ctx,
    { settings: sql`${tenants.settings} || ${JSON.stringify({ [key]: value })}::jsonb` },
    changes,
  );
}

/** How the business runs its leads: workflow, SLA timers and its picklists (docs/leads.md). */
export async function updateCrmSettings(
  ctx: TenantContext,
  input: CrmSettings,
): Promise<{ id: string }> {
  requirePermission(ctx, 'settings.manage');
  const changes = diffChanges(readCrmSettings(ctx.tenant.settings), input);
  if (Object.keys(changes).length > 0) await saveSettingsKey(ctx, 'crm', input, changes);
  return { id: ctx.tenantId };
}

/** What the business calls its records ("Deal" for Opportunity, "Account" for Organization). */
export async function updateLabels(ctx: TenantContext, input: Labels): Promise<{ id: string }> {
  requirePermission(ctx, 'settings.manage');
  const changes = diffChanges(ctx.tenant.labels, input);
  if (Object.keys(changes).length === 0) return { id: ctx.tenantId };
  await updateOwnTenant(ctx, { labels: input }, changes);
  return { id: ctx.tenantId };
}
