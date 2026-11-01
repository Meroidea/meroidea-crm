import 'server-only';

import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  contacts,
  lostReasons,
  opportunities,
  opportunityItems,
  organizations,
  pipelineStages,
  users,
} from '@/db/schema';
import { AppError } from '@/lib/errors';
import { assertCanAccess, canAccess, scopeFilter } from '@/lib/permissions/scope';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { ItemRow, OrganizationItemRow } from './types';

const itemOwners = alias(users, 'item_owners');

const stageJoin = and(
  eq(pipelineStages.tenantId, opportunityItems.tenantId),
  eq(pipelineStages.id, opportunityItems.stageId),
);

/** Revenue is masked unless revenue.view reaches the opportunity, like the opportunity's own. */
function maskRevenue<T extends Pick<ItemRow, 'baseAmount' | 'revenueRate' | 'expectedRevenue'>>(
  row: T,
  show: boolean,
): T {
  return show ? row : { ...row, baseAmount: null, revenueRate: null, expectedRevenue: null };
}

/** The items of one opportunity in the customer's order, for its record page. */
export async function listItemsForOpportunity(
  ctx: TenantContext,
  opportunityId: string,
): Promise<ItemRow[]> {
  requirePermission(ctx, 'opportunities.view');
  return withRls(ctx, async (tx) => {
    const [parent] = await tx
      .select({ ownerUserId: opportunities.ownerUserId })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.tenantId, ctx.tenantId),
          eq(opportunities.id, opportunityId),
          isNull(opportunities.deletedAt),
        ),
      )
      .limit(1);
    if (!parent) throw new AppError('NOT_FOUND', 'That record was not found.');
    assertCanAccess(ctx, 'opportunities.view', parent);

    const rows = await tx
      .select({
        id: opportunityItems.id,
        title: opportunityItems.title,
        organizationId: opportunityItems.organizationId,
        organizationName: organizations.name,
        pipelineId: opportunityItems.pipelineId,
        stageId: opportunityItems.stageId,
        stageName: pipelineStages.name,
        stageColor: pipelineStages.color,
        status: opportunityItems.status,
        stageEnteredAt: opportunityItems.stageEnteredAt,
        closedAt: opportunityItems.closedAt,
        lostReasonName: lostReasons.name,
        lostReasonNote: opportunityItems.lostReasonNote,
        externalReference: opportunityItems.externalReference,
        baseAmount: opportunityItems.baseAmount,
        revenueRate: opportunityItems.revenueRate,
        expectedRevenue: opportunityItems.expectedRevenue,
        currency: opportunityItems.currency,
        ownerUserId: opportunityItems.ownerUserId,
        ownerName: itemOwners.fullName,
        customFields: opportunityItems.customFields,
      })
      .from(opportunityItems)
      .innerJoin(pipelineStages, stageJoin)
      .innerJoin(
        organizations,
        and(
          eq(organizations.tenantId, opportunityItems.tenantId),
          eq(organizations.id, opportunityItems.organizationId),
        ),
      )
      .leftJoin(
        lostReasons,
        and(
          eq(lostReasons.tenantId, opportunityItems.tenantId),
          eq(lostReasons.id, opportunityItems.lostReasonId),
        ),
      )
      .leftJoin(itemOwners, eq(itemOwners.id, opportunityItems.ownerUserId))
      .where(
        and(
          eq(opportunityItems.tenantId, ctx.tenantId),
          eq(opportunityItems.opportunityId, opportunityId),
          isNull(opportunityItems.deletedAt),
        ),
      )
      .orderBy(asc(opportunityItems.position), asc(opportunityItems.createdAt));

    const showRevenue = canAccess(ctx, 'revenue.view', parent);
    return rows.map((row) =>
      maskRevenue(
        { ...row, customFields: (row.customFields ?? {}) as Record<string, unknown> },
        showRevenue,
      ),
    );
  });
}

/**
 * Every item with one organization, across the opportunities the viewer may see: an
 * institution's applications, a vendor's offers. Newest first, at most 100.
 */
export async function listItemsForOrganization(
  ctx: TenantContext,
  organizationId: string,
): Promise<OrganizationItemRow[]> {
  requirePermission(ctx, 'opportunities.view');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        id: opportunityItems.id,
        title: opportunityItems.title,
        opportunityId: opportunities.id,
        opportunityName: opportunities.name,
        contactName: contacts.fullName,
        ownerUserId: opportunities.ownerUserId,
        stageName: pipelineStages.name,
        stageColor: pipelineStages.color,
        status: opportunityItems.status,
        expectedRevenue: opportunityItems.expectedRevenue,
        currency: opportunityItems.currency,
        createdAt: opportunityItems.createdAt,
      })
      .from(opportunityItems)
      .innerJoin(
        opportunities,
        and(
          eq(opportunities.tenantId, opportunityItems.tenantId),
          eq(opportunities.id, opportunityItems.opportunityId),
        ),
      )
      .innerJoin(
        contacts,
        and(
          eq(contacts.tenantId, opportunities.tenantId),
          eq(contacts.id, opportunities.contactId),
        ),
      )
      .innerJoin(pipelineStages, stageJoin)
      .where(
        and(
          eq(opportunityItems.tenantId, ctx.tenantId),
          eq(opportunityItems.organizationId, organizationId),
          isNull(opportunityItems.deletedAt),
          isNull(opportunities.deletedAt),
          scopeFilter(ctx, 'opportunities.view', opportunities),
        ),
      )
      .orderBy(desc(opportunityItems.createdAt))
      .limit(100),
  );
  return rows.map(({ ownerUserId, ...row }) => ({
    ...row,
    contactName: row.contactName ?? '',
    expectedRevenue: canAccess(ctx, 'revenue.view', { ownerUserId }) ? row.expectedRevenue : null,
  }));
}
