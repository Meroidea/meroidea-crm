import 'server-only';

import { and, asc, count, desc, eq, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm';

import { contactOrganizations, contacts, organizations } from '@/db/schema';
import { decodeCursor, encodeCursor, likePattern } from '@/lib/cursor';
import { AppError } from '@/lib/errors';
import { scopeFilter } from '@/lib/permissions/scope';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { OrganizationListFilters } from './schemas';
import type { OrganizationDetail, OrganizationListRow } from './types';

export const ORGANIZATION_PAGE_SIZE = 50;

function baseConditions(ctx: TenantContext, filters: Pick<OrganizationListFilters, 'q'>): SQL[] {
  const conditions: SQL[] = [
    eq(organizations.tenantId, ctx.tenantId),
    isNull(organizations.deletedAt),
  ];
  if (filters.q) {
    const term = or(
      ilike(organizations.name, likePattern(filters.q)),
      ilike(organizations.city, likePattern(filters.q)),
      sql`extensions.similarity(${organizations.name}, ${filters.q}) > 0.3`,
    );
    if (term) conditions.push(term);
  }
  return conditions;
}

export async function listOrganizations(
  ctx: TenantContext,
  filters: OrganizationListFilters,
): Promise<{ items: OrganizationListRow[]; nextCursor: string | null }> {
  requirePermission(ctx, 'organizations.view');
  const conditions = baseConditions(ctx, filters);
  if (filters.type === 'none') conditions.push(isNull(organizations.type));
  else if (filters.type) conditions.push(eq(organizations.type, filters.type));

  const cursor = decodeCursor(filters.cursor);
  if (cursor) {
    conditions.push(
      or(
        lt(organizations.createdAt, cursor.createdAt),
        and(eq(organizations.createdAt, cursor.createdAt), lt(organizations.id, cursor.id)),
      ) as SQL,
    );
  }

  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        id: organizations.id,
        name: organizations.name,
        type: organizations.type,
        city: organizations.city,
        country: organizations.country,
        email: organizations.email,
        phone: organizations.phone,
        createdAt: organizations.createdAt,
        contactCount: sql<number>`(
          select count(*)::int from ${contactOrganizations} co
          where co.tenant_id = ${organizations.tenantId} and co.organization_id = ${organizations.id}
        )`,
      })
      .from(organizations)
      .where(and(...conditions))
      .orderBy(desc(organizations.createdAt), desc(organizations.id))
      .limit(ORGANIZATION_PAGE_SIZE + 1),
  );

  const items = rows.slice(0, ORGANIZATION_PAGE_SIZE);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > ORGANIZATION_PAGE_SIZE && last ? encodeCursor(last) : null,
  };
}

/** Counts per type for the count bar; `null` type is reported as 'none'. */
export async function countOrganizationsByType(
  ctx: TenantContext,
  filters: Pick<OrganizationListFilters, 'q'>,
): Promise<{ type: string; total: number }[]> {
  requirePermission(ctx, 'organizations.view');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({ type: organizations.type, total: count() })
      .from(organizations)
      .where(and(...baseConditions(ctx, filters)))
      .groupBy(organizations.type)
      .orderBy(desc(count())),
  );
  return rows.map((row) => ({ type: row.type ?? 'none', total: row.total }));
}

export async function listOrganizationOptions(
  ctx: TenantContext,
): Promise<{ id: string; name: string }[]> {
  requirePermission(ctx, 'organizations.view');
  return withRls(ctx, (tx) =>
    tx
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(and(eq(organizations.tenantId, ctx.tenantId), isNull(organizations.deletedAt)))
      .orderBy(asc(organizations.name))
      .limit(500),
  );
}

export async function getOrganization(ctx: TenantContext, id: string): Promise<OrganizationDetail> {
  requirePermission(ctx, 'organizations.view');
  return withRls(ctx, async (tx) => {
    const [org] = await tx
      .select()
      .from(organizations)
      .where(
        and(
          eq(organizations.tenantId, ctx.tenantId),
          eq(organizations.id, id),
          isNull(organizations.deletedAt),
        ),
      )
      .limit(1);
    if (!org) throw new AppError('NOT_FOUND', 'That record was not found.');

    const linkWhere = and(
      eq(contactOrganizations.tenantId, ctx.tenantId),
      eq(contactOrganizations.organizationId, id),
      isNull(contacts.deletedAt),
    );
    const linkJoin = and(
      eq(contacts.tenantId, contactOrganizations.tenantId),
      eq(contacts.id, contactOrganizations.contactId),
    );

    // An organization is visible to everyone with organizations.view, but its people are not:
    // each linked contact still goes through the viewer's contacts.view scope.
    const visible = await tx
      .select({
        linkId: contactOrganizations.id,
        contactId: contacts.id,
        fullName: contacts.fullName,
        email: contacts.email,
        relationship: contactOrganizations.relationship,
      })
      .from(contactOrganizations)
      .innerJoin(contacts, linkJoin)
      .where(and(linkWhere, scopeFilter(ctx, 'contacts.view', contacts)))
      .orderBy(asc(contacts.fullName))
      .limit(200);

    const [total] = await tx
      .select({ total: count() })
      .from(contactOrganizations)
      .innerJoin(contacts, linkJoin)
      .where(linkWhere);

    return {
      id: org.id,
      name: org.name,
      type: org.type,
      email: org.email,
      phone: org.phone,
      website: org.website,
      addressLine: org.addressLine,
      city: org.city,
      region: org.region,
      country: org.country,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
      contacts: visible.map((row) => ({ ...row, fullName: row.fullName ?? '' })),
      hiddenContactCount: Math.max(0, (total?.total ?? 0) - visible.length),
    };
  });
}
