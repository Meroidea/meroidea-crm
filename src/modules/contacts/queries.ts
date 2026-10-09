import 'server-only';

import { and, asc, count, desc, eq, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm';

import { contactOrganizations, contacts, leadSources, organizations, users } from '@/db/schema';
import { decodeCursor, encodeCursor, likePattern } from '@/lib/cursor';
import { AppError } from '@/lib/errors';
import { assertCanAccess, scopeFilter } from '@/lib/permissions/scope';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { ContactListFilters, ContactStatus } from './schemas';
import type { ContactDetail, ContactListRow } from './types';

export const CONTACT_PAGE_SIZE = 50;

function baseConditions(
  ctx: TenantContext,
  filters: Omit<ContactListFilters, 'cursor' | 'status'>,
): SQL[] {
  const conditions: (SQL | undefined)[] = [
    eq(contacts.tenantId, ctx.tenantId),
    isNull(contacts.deletedAt),
    scopeFilter(ctx, 'contacts.view', contacts),
  ];

  if (filters.q) {
    const digits = filters.q.replace(/\D/g, '');
    conditions.push(
      or(
        sql`${contacts.search} @@ plainto_tsquery('simple', ${filters.q})`,
        ilike(contacts.fullName, likePattern(filters.q)),
        ilike(contacts.email, likePattern(filters.q)),
        digits.length >= 4 ? ilike(contacts.phoneE164, likePattern(digits)) : undefined,
      ),
    );
  }
  if (filters.source) conditions.push(eq(contacts.sourceId, filters.source));
  if (filters.owner === 'me') conditions.push(eq(contacts.ownerUserId, ctx.userId));
  else if (filters.owner === 'unassigned') conditions.push(isNull(contacts.ownerUserId));
  else if (filters.owner) conditions.push(eq(contacts.ownerUserId, filters.owner));

  return conditions.filter((condition): condition is SQL => condition !== undefined);
}

export async function listContacts(
  ctx: TenantContext,
  filters: ContactListFilters,
): Promise<{ items: ContactListRow[]; nextCursor: string | null }> {
  requirePermission(ctx, 'contacts.view');
  const conditions = baseConditions(ctx, filters);
  if (filters.status) conditions.push(eq(contacts.status, filters.status));

  const cursor = decodeCursor(filters.cursor);
  if (cursor) {
    conditions.push(
      or(
        lt(contacts.createdAt, cursor.createdAt),
        and(eq(contacts.createdAt, cursor.createdAt), lt(contacts.id, cursor.id)),
      ) as SQL,
    );
  }

  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        id: contacts.id,
        fullName: contacts.fullName,
        email: contacts.email,
        phone: contacts.phone,
        status: contacts.status,
        ownerUserId: contacts.ownerUserId,
        ownerName: users.fullName,
        sourceName: leadSources.name,
        createdAt: contacts.createdAt,
        lastActivityAt: contacts.lastActivityAt,
      })
      .from(contacts)
      .leftJoin(users, eq(users.id, contacts.ownerUserId))
      .leftJoin(
        leadSources,
        and(eq(leadSources.tenantId, contacts.tenantId), eq(leadSources.id, contacts.sourceId)),
      )
      .where(and(...conditions))
      .orderBy(desc(contacts.createdAt), desc(contacts.id))
      .limit(CONTACT_PAGE_SIZE + 1),
  );

  const items = rows.slice(0, CONTACT_PAGE_SIZE).map((row) => ({
    ...row,
    fullName: row.fullName ?? '',
  }));
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > CONTACT_PAGE_SIZE && last ? encodeCursor(last) : null,
  };
}

/** Counts per status under the same search and filters: the status count bar above the list. */
export async function countContactsByStatus(
  ctx: TenantContext,
  filters: ContactListFilters,
): Promise<Record<ContactStatus | 'all', number>> {
  requirePermission(ctx, 'contacts.view');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({ status: contacts.status, total: count() })
      .from(contacts)
      .where(and(...baseConditions(ctx, filters)))
      .groupBy(contacts.status),
  );

  const counts: Record<ContactStatus | 'all', number> = {
    all: 0,
    active: 0,
    inactive: 0,
    do_not_contact: 0,
  };
  for (const row of rows) {
    counts[row.status] = row.total;
    counts.all += row.total;
  }
  return counts;
}

export async function getContact(ctx: TenantContext, id: string): Promise<ContactDetail> {
  requirePermission(ctx, 'contacts.view');
  const canViewSensitive = hasPermission(ctx, 'contacts.view_sensitive');

  return withRls(ctx, async (tx) => {
    const [row] = await tx
      .select({
        contact: contacts,
        ownerName: users.fullName,
        sourceName: leadSources.name,
      })
      .from(contacts)
      .leftJoin(users, eq(users.id, contacts.ownerUserId))
      .leftJoin(
        leadSources,
        and(eq(leadSources.tenantId, contacts.tenantId), eq(leadSources.id, contacts.sourceId)),
      )
      .where(
        and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, id), isNull(contacts.deletedAt)),
      )
      .limit(1);

    if (!row) throw new AppError('NOT_FOUND', 'That record was not found.');
    assertCanAccess(ctx, 'contacts.view', row.contact);

    const links = await tx
      .select({
        linkId: contactOrganizations.id,
        organizationId: organizations.id,
        organizationName: organizations.name,
        relationship: contactOrganizations.relationship,
        isPrimary: contactOrganizations.isPrimary,
      })
      .from(contactOrganizations)
      .innerJoin(
        organizations,
        and(
          eq(organizations.tenantId, contactOrganizations.tenantId),
          eq(organizations.id, contactOrganizations.organizationId),
        ),
      )
      .where(
        and(
          eq(contactOrganizations.tenantId, ctx.tenantId),
          eq(contactOrganizations.contactId, id),
          isNull(organizations.deletedAt),
        ),
      )
      .orderBy(desc(contactOrganizations.isPrimary), asc(organizations.name));

    const c = row.contact;
    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      fullName: c.fullName ?? c.firstName,
      email: c.email,
      phone: c.phone,
      altPhone: c.altPhone,
      dateOfBirth: canViewSensitive ? c.dateOfBirth : null,
      canViewSensitive,
      gender: c.gender,
      addressLine: c.addressLine,
      city: c.city,
      region: c.region,
      country: c.country,
      status: c.status,
      ownerUserId: c.ownerUserId,
      ownerName: row.ownerName,
      sourceId: c.sourceId,
      sourceName: row.sourceName,
      marketingConsent: c.marketingConsent,
      consentUpdatedAt: c.consentUpdatedAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      lastActivityAt: c.lastActivityAt,
      organizations: links,
    };
  });
}

/** Contacts the viewer may link a record to, newest first (pickers on other forms). */
export async function listContactOptions(
  ctx: TenantContext,
): Promise<{ id: string; name: string }[]> {
  requirePermission(ctx, 'contacts.view');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({ id: contacts.id, name: contacts.fullName, email: contacts.email })
      .from(contacts)
      .where(and(...baseConditions(ctx, {})))
      .orderBy(asc(contacts.fullName))
      .limit(1000),
  );
  return rows.map((row) => ({ id: row.id, name: row.name ?? '' }));
}
