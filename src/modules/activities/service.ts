import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { activities, contacts, opportunities } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { assertCanAccess } from '@/lib/permissions/scope';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';
import { contactRecord } from '@/modules/contacts/access';
import { noteOutreach, OUTREACH_TYPES } from '@/modules/leads/outreach';
import { readCrmSettings } from '@/modules/leads/settings';

import { CALL_OUTCOMES, type LogActivityInput } from './schemas';

type SystemActivity = {
  type:
    | 'stage_changed'
    | 'owner_changed'
    | 'created'
    | 'task_completed'
    | 'imported'
    | 'status_changed'
    | 'assigned'
    | 'handover'
    | 'handover_accepted'
    | 'handover_rejected'
    | 'converted'
    | 'merged'
    | 'approval'
    | 'enquiry';
  body?: string | null;
  subject: string;
  contactId?: string | null;
  opportunityId?: string | null;
  taskId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * System events (stage moved, task completed…) written inside the caller's transaction. They
 * do not bump last_activity_at: moving a card is not talking to the customer.
 */
export async function recordSystemActivity(
  tx: Tx,
  // userId is null for events with no person behind them, e.g. a website enquiry.
  ctx: { tenantId: string; userId: string | null },
  event: SystemActivity,
): Promise<void> {
  await tx.insert(activities).values({
    tenantId: ctx.tenantId,
    type: event.type,
    subject: event.subject,
    body: event.body ?? null,
    contactId: event.contactId ?? null,
    opportunityId: event.opportunityId ?? null,
    taskId: event.taskId ?? null,
    actorUserId: ctx.userId,
    createdBy: ctx.userId,
    metadata: event.metadata ?? {},
  });
}

/** Several system events at once, e.g. one per row of an upload. */
export async function recordSystemActivities(
  tx: Tx,
  ctx: Pick<TenantContext, 'tenantId' | 'userId'>,
  events: SystemActivity[],
): Promise<void> {
  if (events.length === 0) return;
  await tx.insert(activities).values(
    events.map((event) => ({
      tenantId: ctx.tenantId,
      type: event.type,
      subject: event.subject,
      body: event.body ?? null,
      contactId: event.contactId ?? null,
      opportunityId: event.opportunityId ?? null,
      taskId: event.taskId ?? null,
      actorUserId: ctx.userId,
      createdBy: ctx.userId,
      metadata: event.metadata ?? {},
    })),
  );
}

/** Logs a call, email, meeting, message or note against a record the person can see. */
export async function logActivity(
  ctx: TenantContext,
  input: LogActivityInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'activities.create');

  return withRls(ctx, async (tx) => {
    let contactId = input.contactId ?? null;
    const opportunityId = input.opportunityId ?? null;

    if (opportunityId) {
      const [opportunity] = await tx
        .select({ ownerUserId: opportunities.ownerUserId, contactId: opportunities.contactId })
        .from(opportunities)
        .where(
          and(
            eq(opportunities.tenantId, ctx.tenantId),
            eq(opportunities.id, opportunityId),
            isNull(opportunities.deletedAt),
          ),
        )
        .limit(1);
      if (!opportunity) throw new AppError('NOT_FOUND', 'That record was not found.');
      assertCanAccess(ctx, 'opportunities.view', opportunity);
      contactId = contactId ?? opportunity.contactId;
    } else if (contactId) {
      const [contact] = await tx
        .select({
          ownerUserId: contacts.ownerUserId,
          originatorUserId: contacts.originatorUserId,
          handoverToUserId: contacts.handoverToUserId,
        })
        .from(contacts)
        .where(
          and(
            eq(contacts.tenantId, ctx.tenantId),
            eq(contacts.id, contactId),
            isNull(contacts.deletedAt),
          ),
        )
        .limit(1);
      if (!contact) throw new AppError('NOT_FOUND', 'That record was not found.');
      assertCanAccess(ctx, 'contacts.view', contactRecord(contact));
    }

    let outcome: string | null = null;
    if (input.type === 'call' && input.outcome) {
      const allowed = [...readCrmSettings(ctx.tenant.settings).callOutcomes, ...CALL_OUTCOMES];
      if (!allowed.includes(input.outcome)) {
        throw new AppError('VALIDATION', 'Choose one of the call outcomes.', {
          outcome: ['Invalid'],
        });
      }
      outcome = input.outcome;
    }

    const now = new Date();
    const [created] = await tx
      .insert(activities)
      .values({
        tenantId: ctx.tenantId,
        type: input.type,
        body: input.body || null,
        direction: input.type === 'note' ? null : (input.direction ?? 'outbound'),
        outcome: input.type === 'call' ? outcome : null,
        occurredAt: now,
        contactId,
        opportunityId,
        actorUserId: ctx.userId,
        createdBy: ctx.userId,
      })
      .returning({ id: activities.id });
    if (!created) throw new AppError('INTERNAL', 'Could not save the activity.');

    // Interactions are what "last activity" and stale detection measure.
    if (contactId && OUTREACH_TYPES.includes(input.type) && input.direction !== 'inbound') {
      await noteOutreach(tx, ctx, contactId);
    }
    if (contactId) {
      await tx
        .update(contacts)
        .set({ lastActivityAt: now })
        .where(and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, contactId)));
    }
    if (opportunityId) {
      await tx
        .update(opportunities)
        .set({ lastActivityAt: now })
        .where(and(eq(opportunities.tenantId, ctx.tenantId), eq(opportunities.id, opportunityId)));
    }

    await audit(tx, ctx, {
      action: 'create',
      entityType: 'activity',
      entityId: created.id,
      context: { type: input.type, contactId, opportunityId },
    });
    return created;
  });
}
