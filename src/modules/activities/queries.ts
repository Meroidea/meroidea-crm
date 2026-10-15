import 'server-only';

import { and, desc, eq, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { activities, auditLogs, contacts, opportunities, users } from '@/db/schema';
import { scopeFilter } from '@/lib/permissions/scope';
import type { TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';
import { contactScope as contactResponsible } from '@/modules/contacts/access';

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
      ? and(
          eq(activities.contactId, target.contactId),
          // A contact's own history, plus what happened on its opportunities that the viewer
          // can open. Seeing a person is not seeing every deal they are part of.
          or(
            isNull(activities.opportunityId),
            and(
              isNull(opportunities.deletedAt),
              scopeFilter(ctx, 'opportunities.view', opportunities) ?? sql`true`,
            ),
          ),
        )
      : undefined;
  if (!match) return [];

  return withRls(ctx, async (tx) => {
    const [items, changes] = await Promise.all([
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
      // Edits to the record's own fields, from the audit trail: who changed what, and when
      // (docs/leads.md §6.3). Field names only — values can be personal data.
      tx
        .select({
          id: auditLogs.id,
          occurredAt: auditLogs.createdAt,
          changes: auditLogs.changes,
          actorName: actors.fullName,
        })
        .from(auditLogs)
        .leftJoin(actors, eq(actors.id, auditLogs.actorUserId))
        .where(
          and(
            eq(auditLogs.tenantId, ctx.tenantId),
            eq(auditLogs.action, 'update'),
            eq(auditLogs.entityType, target.opportunityId ? 'opportunity' : 'contact'),
            eq(auditLogs.entityId, (target.opportunityId ?? target.contactId)!),
            isNotNull(auditLogs.changes),
          ),
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit),
    ]);
    const edits: TimelineItem[] = changes.flatMap((change) => {
      const fields = Object.keys((change.changes ?? {}) as Record<string, unknown>)
        .filter((key) => !HIDDEN_FIELDS.has(key))
        .map(fieldWords);
      if (fields.length === 0) return [];
      return [
        {
          id: `audit-${change.id}`,
          type: 'field_changed',
          subject: `Changed ${fields.join(', ')}`,
          body: null,
          outcome: null,
          direction: null,
          occurredAt: change.occurredAt,
          actorName: change.actorName,
          contactId: target.contactId ?? null,
          contactName: null,
          opportunityId: target.opportunityId ?? null,
          opportunityName: null,
        },
      ];
    });
    return [...items, ...edits]
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, limit);
  });
}

/** Changes the timeline already tells in its own words, or that mean nothing to a person. */
const HIDDEN_FIELDS = new Set(['leadStatusId', 'stageId', 'checklistState', 'updatedBy']);

const FIELD_WORDS: Record<string, string> = {
  phoneE164: 'phone',
  dateOfBirth: 'date of birth',
  linkedinUrl: 'LinkedIn',
  customFields: 'custom fields',
  subSourceId: 'sub-source',
  sourceId: 'source',
  organizationId: 'organization',
  contactId: 'contact',
  partnerId: 'partner',
};

/** "companyWebsite" → "company website". */
function fieldWords(key: string): string {
  return FIELD_WORDS[key] ?? key.replace(/([A-Z])/g, ' $1').toLowerCase();
}

/** Recent activity across the records the viewer can see: the dashboard feed. */
export async function getRecentActivity(ctx: TenantContext, limit = 12): Promise<TimelineItem[]> {
  const contactScope = scopeFilter(ctx, 'contacts.view', contacts, contactResponsible);
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
