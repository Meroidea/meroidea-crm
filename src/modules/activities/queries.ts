import 'server-only';

import { and, desc, eq, isNull, or, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { activities, contacts, opportunities, users } from '@/db/schema';
import { scopeFilter } from '@/lib/permissions/scope';
import type { TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { TimelineItem } from './types';

const actors = alias(users, 'actors');

const columns = {
  id: activities.id,
  type: activities.type,
  subject: activities.subject,
  body: activities.body,
  outcome: activities.outcome,
  direction: activities.direction,
  occurredAt: activities.occurredAt,
  actorName: actors.fullName,
  contactId: activities.contactId,
  contactName: contacts.fullName,
  opportunityId: activities.opportunityId,
  opportunityName: opportunities.name,
};

/**
 * History for one record. Callers have already checked the record itself is in scope; the
 * timeline follows it (docs/permissions.md: child records inherit the parent's access).
 */
export async function getTimeline(
  ctx: TenantContext,
  target: { contactId?: string; opportunityId?: string },
  limit = 50,
): Promise<TimelineItem[]> {
  const match: SQL | undefined = target.opportunityId
    ? eq(activities.opportunityId, target.opportunityId)
    : target.contactId
      ? eq(activities.contactId, target.contactId)
      : undefined;
  if (!match) return [];

  return withRls(ctx, (tx) =>
    tx
      .select(columns)
      .from(activities)
      .leftJoin(actors, eq(actors.id, activities.actorUserId))
      .leftJoin(
        contacts,
        and(eq(contacts.tenantId, activities.tenantId), eq(contacts.id, activities.contactId)),
      )
      .leftJoin(
        opportunities,
        and(
          eq(opportunities.tenantId, activities.tenantId),
          eq(opportunities.id, activities.opportunityId),
        ),
      )
      .where(and(eq(activities.tenantId, ctx.tenantId), isNull(activities.deletedAt), match))
      .orderBy(desc(activities.occurredAt))
      .limit(limit),
  );
}

/** Recent activity across the records the viewer can see: the dashboard feed. */
export async function getRecentActivity(ctx: TenantContext, limit = 12): Promise<TimelineItem[]> {
  const contactScope = scopeFilter(ctx, 'contacts.view', contacts);
  const opportunityScope = scopeFilter(ctx, 'opportunities.view', opportunities);

  return withRls(ctx, (tx) =>
    tx
      .select(columns)
      .from(activities)
      .leftJoin(actors, eq(actors.id, activities.actorUserId))
      .leftJoin(
        contacts,
        and(eq(contacts.tenantId, activities.tenantId), eq(contacts.id, activities.contactId)),
      )
      .leftJoin(
        opportunities,
        and(
          eq(opportunities.tenantId, activities.tenantId),
          eq(opportunities.id, activities.opportunityId),
        ),
      )
      .where(
        and(
          eq(activities.tenantId, ctx.tenantId),
          isNull(activities.deletedAt),
          or(
            and(eq(activities.opportunityId, opportunities.id), opportunityScope),
            and(
              isNull(activities.opportunityId),
              eq(activities.contactId, contacts.id),
              contactScope,
            ),
          ),
        ),
      )
      .orderBy(desc(activities.occurredAt))
      .limit(limit),
  );
}
