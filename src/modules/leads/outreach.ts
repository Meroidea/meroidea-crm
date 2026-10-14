import 'server-only';

import { and, asc, eq, isNull, or } from 'drizzle-orm';

import { activities, contacts, leadStatuses } from '@/db/schema';
import { audit } from '@/server/audit';
import type { Tx } from '@/server/db/with-rls';

/**
 * The first call, email or meeting logged with a lead starts its outreach (docs/leads.md §4.4):
 * it records the first contact (measured by the SLA) and moves a New lead to the first working
 * status for its type. Called inside the transaction that logs the activity.
 */
export async function noteOutreach(
  tx: Tx,
  ctx: { tenantId: string; userId: string },
  contactId: string,
): Promise<void> {
  const [lead] = await tx
    .select({
      id: contacts.id,
      leadType: contacts.leadType,
      leadStatusId: contacts.leadStatusId,
      firstContactedAt: contacts.firstContactedAt,
      kind: leadStatuses.kind,
      statusName: leadStatuses.name,
    })
    .from(contacts)
    .innerJoin(
      leadStatuses,
      and(eq(leadStatuses.tenantId, contacts.tenantId), eq(leadStatuses.id, contacts.leadStatusId)),
    )
    .where(and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, contactId)))
    .limit(1);
  if (!lead) return;

  const now = new Date();
  let next: { id: string; name: string } | undefined;
  if (lead.kind === 'new') {
    [next] = await tx
      .select({ id: leadStatuses.id, name: leadStatuses.name })
      .from(leadStatuses)
      .where(
        and(
          eq(leadStatuses.tenantId, ctx.tenantId),
          eq(leadStatuses.kind, 'working'),
          eq(leadStatuses.isActive, true),
          lead.leadType
            ? or(isNull(leadStatuses.leadType), eq(leadStatuses.leadType, lead.leadType))
            : isNull(leadStatuses.leadType),
        ),
      )
      .orderBy(asc(leadStatuses.position))
      .limit(1);
  }
  if (!next && lead.firstContactedAt) return;

  await tx
    .update(contacts)
    .set({
      ...(lead.firstContactedAt ? {} : { firstContactedAt: now }),
      ...(next ? { leadStatusId: next.id, leadStatusChangedAt: now } : {}),
    })
    .where(and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, lead.id)));
  if (next) {
    await tx.insert(activities).values({
      tenantId: ctx.tenantId,
      type: 'status_changed',
      subject: `Status: ${lead.statusName} → ${next.name}`,
      contactId: lead.id,
      actorUserId: ctx.userId,
      createdBy: ctx.userId,
      metadata: { fromStatusId: lead.leadStatusId, toStatusId: next.id, automatic: true },
    });
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'contact',
      entityId: lead.id,
      changes: { leadStatusId: [lead.leadStatusId, next.id] },
      context: { reason: 'first outreach' },
    });
  }
}

export const OUTREACH_TYPES: string[] = ['call', 'email', 'meeting', 'message'];
