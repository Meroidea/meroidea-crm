import 'server-only';

import { sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import { AppError } from '@/lib/errors';
import { featureForPermission, isFeatureKey, type FeatureKey } from '@/lib/features';
import type { Grant, PermissionKey } from '@/lib/permissions/catalog';
import { resolveLabels, type Labels } from '@/lib/tenant/labels';
import { withAuthedSession, type SessionClaims } from '@/server/db/with-rls';
import { getPlatformAdmin } from '@/server/platform';
import { createSupabaseServerClient } from '@/server/supabase/server';

/** Names the business a multi-business person has open. */
export const ACTIVE_TENANT_COOKIE = 'meroidea_tenant';

export type TenantContext = {
  userId: string;
  email: string;
  tenantId: string;
  membershipId: string;
  roleKey: string;
  roleName: string;
  grants: Map<PermissionKey, Grant>;
  /** Users visible under `team` scope: colleagues in my team(s) and teams I manage, plus me. */
  teamUserIds: string[];
  claims: SessionClaims;
  /** True while a platform owner is inside this business on a temporary support seat. */
  isSupport: boolean;
  tenant: {
    name: string;
    slug: string;
    timezone: string;
    currency: string;
    country: string | null;
    primaryColor: string | null;
    status: string;
    /** Features the platform owner has switched on for this business (ADR-029). */
    features: FeatureKey[];
    labels: Labels;
    settings: Record<string, unknown>;
    /** Set by the platform owner; when present, clocking in and out must happen within it. */
    clockLocation: { latitude: number; longitude: number; radiusMetres: number } | null;
  };
};

type ContextRow = {
  tenant_id: string;
  membership_id: string;
  role_key: string;
  role_name: string;
  tenant_name: string;
  tenant_slug: string;
  tenant_timezone: string;
  tenant_currency: string;
  tenant_country: string | null;
  tenant_primary_color: string | null;
  tenant_status: string;
  tenant_labels: unknown;
  tenant_settings: unknown;
  grants: Record<string, string>;
  tenant_features: string[] | null;
  is_support: boolean;
  location_latitude: string | null;
  location_longitude: string | null;
  clock_radius_metres: number;
  team_user_ids: string[] | null;
};

/**
 * Builds the context for an already-verified user in one database round trip
 * (app.my_context). Separate from the cookie-reading getTenantContext() so services can be
 * exercised in DB tests with a real session.
 */
export async function loadTenantContext(
  claims: SessionClaims,
  preferredTenantId: string | null = null,
): Promise<TenantContext | null> {
  const rows = (await withAuthedSession(claims, (tx) =>
    tx.execute(sql`select * from app.my_context(${preferredTenantId})`),
  )) as unknown as ContextRow[];

  const row = rows[0];
  if (!row) return null;

  const features = (row.tenant_features ?? []).filter(isFeatureKey);

  // The database already leaves out grants whose feature is switched off (ADR-038). Checking
  // again here keeps pages, menus and actions correct even if the two catalogs ever drift.
  const grants = new Map<PermissionKey, Grant>();
  for (const [permission, scope] of Object.entries(row.grants ?? {})) {
    const feature = featureForPermission(permission);
    if (feature && !features.includes(feature)) continue;
    grants.set(permission as PermissionKey, scope === 'true' ? true : (scope as Grant));
  }

  return {
    userId: claims.sub,
    email: claims.email ?? '',
    tenantId: row.tenant_id,
    membershipId: row.membership_id,
    roleKey: row.role_key,
    roleName: row.role_name,
    grants,
    teamUserIds: row.team_user_ids ?? [claims.sub],
    claims,
    isSupport: row.is_support,
    tenant: {
      name: row.tenant_name,
      slug: row.tenant_slug,
      timezone: row.tenant_timezone,
      currency: row.tenant_currency,
      country: row.tenant_country,
      primaryColor: row.tenant_primary_color,
      status: row.tenant_status,
      features,
      labels: resolveLabels(row.tenant_labels),
      settings: (row.tenant_settings ?? {}) as Record<string, unknown>,
      clockLocation:
        row.location_latitude !== null && row.location_longitude !== null
          ? {
              latitude: Number(row.location_latitude),
              longitude: Number(row.location_longitude),
              radiusMetres: row.clock_radius_metres,
            }
          : null,
    },
  };
}

/** Resolved once per request. Returns null when nobody is signed in. */
export const getTenantContext = cache(async (): Promise<TenantContext | null> => {
  const supabase = await createSupabaseServerClient();
  // getUser() verifies with the auth server; getSession() only reads a cookie (rules/security.md).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const claims: SessionClaims = { sub: user.id, role: 'authenticated', email: user.email };
  // Someone in more than one business (a platform owner giving support) chooses which one is
  // open; the choice is only honoured when they really are a member of it.
  const chosen = (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value ?? null;
  const preferred = chosen && /^[0-9a-f-]{36}$/i.test(chosen) ? chosen : null;
  return (
    (await loadTenantContext(claims, preferred)) ?? (preferred ? loadTenantContext(claims) : null)
  );
});

/** For pages: sends anyone without a workspace back to sign-in, and a suspended business to a notice. */
export async function requireTenantContext(): Promise<TenantContext> {
  const ctx = await getTenantContext();
  // A platform owner with no workspace of their own belongs in the console, not back at sign-in.
  if (!ctx) redirect((await getPlatformAdmin()) ? '/platform' : '/login');
  if (ctx.tenant.status === 'suspended' && !ctx.isSupport) redirect('/suspended');
  return ctx;
}

export function hasFeature(ctx: TenantContext, feature: FeatureKey): boolean {
  return ctx.tenant.features.includes(feature);
}

export function hasPermission(ctx: TenantContext, key: PermissionKey): boolean {
  return ctx.grants.has(key);
}

export function requirePermission(ctx: TenantContext, key: PermissionKey): void {
  if (!hasPermission(ctx, key)) {
    throw new AppError('FORBIDDEN', 'You do not have access to that.');
  }
}
