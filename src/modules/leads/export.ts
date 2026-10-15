import 'server-only';

import { and, desc, eq } from 'drizzle-orm';

import { contacts, leadSources, leadStatuses, leadSubSources } from '@/db/schema';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';
import { toCsv } from '@/lib/csv';

import { baseConditions, handoverTo, owners, type LeadView } from './queries';
import type { LeadQueueFilters } from './schemas';

/** Enough for any one business's working list; a bigger export is a database job, not a click. */
export const LEAD_EXPORT_LIMIT = 5000;

const iso = (value: Date | null) => (value ? value.toISOString() : '');

/**
 * The leads list as CSV, under the same view, filters and scope as the screen (docs/leads.md
 * §7). Contact details go out, so it needs contacts.export and every export is audited.
 * Dates of birth and other sensitive fields are never included.
 */
export async function exportLeads(
  ctx: TenantContext,
  filters: LeadQueueFilters,
): Promise<{ csv: string; rows: number; truncated: boolean }> {
  requirePermission(ctx, 'contacts.view');
  requirePermission(ctx, 'contacts.export');
  const view: LeadView = filters.view ?? 'mine';

  return withRls(ctx, async (tx) => {
    const rows = await tx
      .select({
        contact: contacts,
        statusName: leadStatuses.name,
        sourceName: leadSources.name,
        subSourceName: leadSubSources.name,
        ownerName: owners.fullName,
        handoverToName: handoverTo.fullName,
      })
      .from(contacts)
      .innerJoin(
        leadStatuses,
        and(
          eq(leadStatuses.tenantId, contacts.tenantId),
          eq(leadStatuses.id, contacts.leadStatusId),
        ),
      )
      .leftJoin(
        leadSources,
        and(eq(leadSources.tenantId, contacts.tenantId), eq(leadSources.id, contacts.sourceId)),
      )
      .leftJoin(
        leadSubSources,
        and(
          eq(leadSubSources.tenantId, contacts.tenantId),
          eq(leadSubSources.id, contacts.subSourceId),
        ),
      )
      .leftJoin(owners, eq(owners.id, contacts.ownerUserId))
      .leftJoin(handoverTo, eq(handoverTo.id, contacts.handoverToUserId))
      .where(and(...baseConditions(ctx, { ...filters, cursor: undefined }, view)))
      .orderBy(desc(contacts.createdAt), desc(contacts.id))
      .limit(LEAD_EXPORT_LIMIT + 1);

    const shown = rows.slice(0, LEAD_EXPORT_LIMIT);
    const csv = toCsv(
      shown.map(({ contact: c, ...row }) => ({
        'First name': c.firstName,
        'Last name': c.lastName ?? '',
        Email: c.email ?? '',
        Phone: c.phone ?? '',
        Company: c.companyName ?? '',
        'Job title': c.jobTitle ?? '',
        Industry: c.industry ?? '',
        'Company size': c.companySize ?? '',
        Country: c.country ?? '',
        'Lead type': c.leadType?.toUpperCase() ?? '',
        Status: row.statusName,
        Source: row.sourceName ?? '',
        'Sub-source': row.subSourceName ?? '',
        Campaign: c.campaignName ?? '',
        Owner: row.ownerName ?? '',
        'Handed over to': row.handoverToName ?? '',
        Created: iso(c.createdAt),
        'First contacted': iso(c.firstContactedAt),
        'Last activity': iso(c.lastActivityAt),
        'Marketing consent': c.marketingConsent ? 'Yes' : 'No',
        'Do not email': c.doNotEmail ? 'Yes' : 'No',
        'Do not call': c.doNotCall ? 'Yes' : 'No',
      })),
    );
    await audit(tx, ctx, {
      action: 'export',
      entityType: 'contact',
      entityId: null,
      context: {
        what: 'leads',
        view,
        filtered: Boolean(
          filters.q || filters.status || filters.source || filters.type || filters.owner,
        ),
        rows: shown.length,
      },
    });
    return { csv, rows: shown.length, truncated: rows.length > LEAD_EXPORT_LIMIT };
  });
}
