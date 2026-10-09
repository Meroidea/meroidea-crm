import 'server-only';

import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { opportunities, organizations, partners } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

export type PartnerRow = {
  id: string;
  organizationId: string;
  name: string;
  status: 'prospect' | 'active' | 'inactive';
  commissionType: 'none' | 'percentage' | 'fixed' | null;
  commissionValue: string | null;
  notes: string | null;
  referred: number;
  open: number;
  won: number;
};

/**
 * Referral counts cover every opportunity in the workspace: a partner's performance is a
 * workspace-level fact, and only aggregates are shown — never the individual records.
 */
export async function listPartners(ctx: TenantContext): Promise<PartnerRow[]> {
  requirePermission(ctx, 'partners.view');
  const showTerms = hasPermission(ctx, 'partners.view_commission');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        id: partners.id,
        organizationId: partners.organizationId,
        name: organizations.name,
        status: partners.status,
        commissionType: partners.commissionType,
        commissionValue: partners.commissionValue,
        notes: partners.notes,
        referred: sql<number>`count(${opportunities.id})::int`,
        open: sql<number>`count(${opportunities.id}) filter (where ${opportunities.status} = 'open')::int`,
        won: sql<number>`count(${opportunities.id}) filter (where ${opportunities.status} = 'won')::int`,
      })
      .from(partners)
      .innerJoin(
        organizations,
        and(
          eq(organizations.tenantId, partners.tenantId),
          eq(organizations.id, partners.organizationId),
        ),
      )
      .leftJoin(
        opportunities,
        and(
          eq(opportunities.tenantId, partners.tenantId),
          eq(opportunities.partnerId, partners.id),
          isNull(opportunities.deletedAt),
        ),
      )
      .where(and(eq(partners.tenantId, ctx.tenantId), isNull(partners.deletedAt)))
      .groupBy(partners.id, organizations.name)
      .orderBy(asc(organizations.name)),
  );
  return rows.map((row) => ({
    ...row,
    commissionType: showTerms ? row.commissionType : null,
    commissionValue: showTerms ? row.commissionValue : null,
  }));
}

export async function getPartner(ctx: TenantContext, id: string): Promise<PartnerRow> {
  const rows = await listPartners(ctx);
  const partner = rows.find((row) => row.id === id);
  if (!partner) throw new AppError('NOT_FOUND', 'That partner was not found.');
  return partner;
}

export async function listPartnerOptions(
  ctx: TenantContext,
): Promise<{ id: string; name: string }[]> {
  if (!hasPermission(ctx, 'partners.view')) return [];
  return withRls(ctx, (tx) =>
    tx
      .select({ id: partners.id, name: organizations.name })
      .from(partners)
      .innerJoin(
        organizations,
        and(
          eq(organizations.tenantId, partners.tenantId),
          eq(organizations.id, partners.organizationId),
        ),
      )
      .where(
        and(
          eq(partners.tenantId, ctx.tenantId),
          isNull(partners.deletedAt),
          eq(partners.status, 'active'),
        ),
      )
      .orderBy(asc(organizations.name)),
  );
}
