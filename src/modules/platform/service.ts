import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, asc, eq, sql } from 'drizzle-orm';

import { auditLogs, roles, tenantMemberships, tenants } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { isFeatureKey, type FeatureKey } from '@/lib/features';
import { provisionTenant } from '@/modules/tenants/provision';
import { adminDb } from '@/server/db/admin';
import type { PlatformAdmin } from '@/server/platform';
import { createSupabaseAdminClient } from '@/server/supabase/admin';

import type { CreateBusinessInput, SetLocationInput } from './schemas';

/*
 * The platform owner's side of Meroidea (ADR-029). These functions cross every business, so they
 * use the privileged connection; each one takes the verified PlatformAdmin as proof the caller
 * was checked, and anything that touches a business is written to that business's own audit log.
 */

export type BusinessRow = {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  status: string;
  features: FeatureKey[];
  members: number;
  createdAt: Date;
  locationLatitude: string | null;
  locationLongitude: string | null;
  clockRadiusMetres: number;
};

const columns = {
  id: tenants.id,
  name: tenants.name,
  slug: tenants.slug,
  industry: tenants.industry,
  status: tenants.status,
  features: tenants.features,
  members: sql<number>`(select count(*)::int from tenant_memberships m
    where m.tenant_id = tenants.id and m.status = 'active' and not m.is_support)`,
  createdAt: tenants.createdAt,
  locationLatitude: tenants.locationLatitude,
  locationLongitude: tenants.locationLongitude,
  clockRadiusMetres: tenants.clockRadiusMetres,
};

const clean = (row: Omit<BusinessRow, 'features'> & { features: string[] }): BusinessRow => ({
  ...row,
  features: row.features.filter(isFeatureKey),
});

// `admin` is taken by the read functions too, unused, so they cannot be called without one.
export async function listBusinesses(admin: PlatformAdmin): Promise<BusinessRow[]> {
  void admin;
  const rows = await adminDb().select(columns).from(tenants).orderBy(asc(tenants.name));
  return rows.map(clean);
}

export async function getBusiness(admin: PlatformAdmin, id: string): Promise<BusinessRow | null> {
  void admin;
  const [row] = await adminDb().select(columns).from(tenants).where(eq(tenants.id, id)).limit(1);
  return row ? clean(row) : null;
}

function record(
  tenantId: string,
  admin: PlatformAdmin,
  entry: { action: string; context: Record<string, unknown> },
) {
  return adminDb().insert(auditLogs).values({
    tenantId,
    actorUserId: admin.userId,
    actorType: 'platform',
    action: entry.action,
    entityType: 'tenant',
    entityId: tenantId,
    context: entry.context,
  });
}

/**
 * Onboards a client business: its workspace, its first admin's login, and the features agreed
 * with them. The admin's temporary password is returned once so it can be handed over; it is
 * never stored or logged here.
 */
export async function createBusiness(
  admin: PlatformAdmin,
  input: CreateBusinessInput,
): Promise<{ tenantId: string; adminEmail: string; temporaryPassword: string }> {
  const temporaryPassword = randomBytes(12).toString('base64url');
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.auth.admin.createUser({
    email: input.adminEmail.toLowerCase(),
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: input.adminName },
  });
  if (error || !data.user) {
    throw new AppError(
      'CONFLICT',
      'That email already has a login. Use a different address for this admin.',
      {
        adminEmail: ['This email already has a login'],
      },
    );
  }

  try {
    const { tenantId } = await provisionTenant({
      userId: data.user.id,
      companyName: input.companyName,
      industry: input.businessType,
      features: input.features,
      source: 'platform',
    });
    await adminDb().update(tenants).set({ status: 'active' }).where(eq(tenants.id, tenantId));
    await record(tenantId, admin, {
      action: 'create',
      context: { onboardedBy: 'platform', features: input.features },
    });
    return { tenantId, adminEmail: input.adminEmail.toLowerCase(), temporaryPassword };
  } catch (cause) {
    // Don't leave a login behind for a business that was never created.
    await supabase.auth.admin.deleteUser(data.user.id);
    throw cause;
  }
}

export async function setBusinessFeatures(
  admin: PlatformAdmin,
  input: { tenantId: string; features: FeatureKey[] },
): Promise<{ id: string }> {
  const [updated] = await adminDb()
    .update(tenants)
    .set({ features: input.features })
    .where(eq(tenants.id, input.tenantId))
    .returning({ id: tenants.id });
  if (!updated) throw new AppError('NOT_FOUND', 'That business was not found.');
  await record(input.tenantId, admin, {
    action: 'update',
    context: { features: input.features },
  });
  return updated;
}

/**
 * Sets where a business is. From then on its staff can only clock in and out within the radius;
 * clearing the location removes the restriction.
 */
export async function setBusinessLocation(
  admin: PlatformAdmin,
  input: SetLocationInput,
): Promise<{ id: string }> {
  const [updated] = await adminDb()
    .update(tenants)
    .set({
      locationLatitude: input.latitude || null,
      locationLongitude: input.longitude || null,
      clockRadiusMetres: input.radiusMetres,
    })
    .where(eq(tenants.id, input.tenantId))
    .returning({ id: tenants.id });
  if (!updated) throw new AppError('NOT_FOUND', 'That business was not found.');
  await record(input.tenantId, admin, {
    action: 'update',
    context: {
      clockLocation: input.latitude ? 'set' : 'cleared',
      radiusMetres: input.radiusMetres,
    },
  });
  return updated;
}

/** Suspending keeps every record and locks the business's own people out until reactivated. */
export async function setBusinessStatus(
  admin: PlatformAdmin,
  input: { tenantId: string; status: 'active' | 'suspended' },
): Promise<{ id: string }> {
  const [updated] = await adminDb()
    .update(tenants)
    .set({ status: input.status })
    .where(eq(tenants.id, input.tenantId))
    .returning({ id: tenants.id });
  if (!updated) throw new AppError('NOT_FOUND', 'That business was not found.');
  await record(input.tenantId, admin, { action: 'update', context: { status: input.status } });
  return updated;
}

/**
 * Lets a platform owner into a business with full access, by giving them a temporary owner seat
 * marked as support. It is a real seat on purpose: the business sees it in its own team list and
 * audit log, and every rule that protects one business from another keeps applying unchanged.
 */
export async function startSupportAccess(admin: PlatformAdmin, tenantId: string): Promise<void> {
  const db = adminDb();
  const [owner] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.key, 'owner')))
    .limit(1);
  if (!owner) throw new AppError('NOT_FOUND', 'That business was not found.');

  const [existing] = await db
    .select({ id: tenantMemberships.id })
    .from(tenantMemberships)
    .where(
      and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, admin.userId)),
    )
    .limit(1);
  // Already a member in their own right (their own business): nothing to add.
  if (existing) return;

  await db.insert(tenantMemberships).values({
    tenantId,
    userId: admin.userId,
    roleId: owner.id,
    status: 'active',
    isSupport: true,
  });
  await record(tenantId, admin, {
    action: 'permission_change',
    context: { supportAccess: 'started' },
  });
}

export async function endSupportAccess(admin: PlatformAdmin, tenantId: string): Promise<void> {
  const removed = await adminDb()
    .delete(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.userId, admin.userId),
        eq(tenantMemberships.isSupport, true),
      ),
    )
    .returning({ id: tenantMemberships.id });
  if (removed.length > 0) {
    await record(tenantId, admin, {
      action: 'permission_change',
      context: { supportAccess: 'ended' },
    });
  }
}
