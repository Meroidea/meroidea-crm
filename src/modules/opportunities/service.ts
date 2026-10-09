import 'server-only';

import { and, eq, isNull, min } from 'drizzle-orm';

import {
  contacts,
  lostReasons,
  opportunities,
  partners,
  pipelineStages,
  stageHistory,
  tasks,
} from '@/db/schema';
import { diffChanges } from '@/lib/audit-diff';
import { AppError } from '@/lib/errors';
import { assertCanAccess, scopeDecision } from '@/lib/permissions/scope';
import { recordSystemActivity } from '@/modules/activities/service';
import { loadPipelineConfig } from '@/modules/pipelines/queries';
import { audit } from '@/server/audit';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import type { CreateOpportunityInput, MoveStageInput, UpdateOpportunityInput } from './schemas';

function assertCanAssign(ctx: TenantContext, ownerUserId: string | null): void {
  if (ownerUserId === ctx.userId) return;
  const decision = scopeDecision(ctx, 'opportunities.assign');
  const allowed =
    decision.kind === 'all' ||
    (decision.kind === 'owners' && ownerUserId !== null && decision.userIds.includes(ownerUserId));
  if (!allowed) {
    throw new AppError('FORBIDDEN', 'You can’t assign records to that person.', {
      ownerUserId: ['Choose yourself or someone in your team'],
    });
  }
}

async function loadForWrite(tx: Tx, ctx: TenantContext, id: string) {
  const [row] = await tx
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.tenantId, ctx.tenantId),
        eq(opportunities.id, id),
        isNull(opportunities.deletedAt),
      ),
    )
    .limit(1)
    .for('update');
  if (!row) throw new AppError('NOT_FOUND', 'That record was not found.');
  return row;
}

/** The contact must exist and be visible to the person linking it. */
async function assertContactVisible(tx: Tx, ctx: TenantContext, contactId: string) {
  const [contact] = await tx
    .select({ ownerUserId: contacts.ownerUserId, sourceId: contacts.sourceId })
    .from(contacts)
    .where(
      and(
        eq(contacts.tenantId, ctx.tenantId),
        eq(contacts.id, contactId),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1);
  if (!contact)
    throw new AppError('VALIDATION', 'Choose who this is for.', { contactId: ['Not found'] });
  assertCanAccess(ctx, 'contacts.view', contact);
  return contact;
}

async function assertPartnerExists(tx: Tx, ctx: TenantContext, partnerId: string | null) {
  if (!partnerId) return;
  const [partner] = await tx
    .select({ id: partners.id })
    .from(partners)
    .where(
      and(
        eq(partners.tenantId, ctx.tenantId),
        eq(partners.id, partnerId),
        isNull(partners.deletedAt),
      ),
    )
    .limit(1);
  if (!partner)
    throw new AppError('VALIDATION', 'That partner was not found.', { partnerId: ['Not found'] });
}

export async function createOpportunity(
  ctx: TenantContext,
  input: CreateOpportunityInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'opportunities.create');
  const ownerUserId = input.ownerUserId ?? ctx.userId;
  assertCanAssign(ctx, ownerUserId);

  return withRls(ctx, async (tx) => {
    const contact = await assertContactVisible(tx, ctx, input.contactId);
    await assertPartnerExists(tx, ctx, input.partnerId);
    const pipeline = await loadPipelineConfig(tx, ctx);
    const stage = input.stageId
      ? pipeline.stages.find((candidate) => candidate.id === input.stageId && candidate.isActive)
      : pipeline.stages.find((candidate) => candidate.category === 'open' && candidate.isActive);
    if (!stage)
      throw new AppError('VALIDATION', 'Choose a stage in this pipeline.', {
        stageId: ['Invalid stage'],
      });
    if (stage.category === 'lost') {
      throw new AppError('VALIDATION', 'A new opportunity can’t start as lost.', {
        stageId: ['Choose an open stage'],
      });
    }

    const now = new Date();
    const [created] = await tx
      .insert(opportunities)
      .values({
        tenantId: ctx.tenantId,
        contactId: input.contactId,
        organizationId: input.organizationId,
        name: input.name,
        pipelineId: pipeline.id,
        stageId: stage.id,
        status: stage.category,
        ownerUserId,
        sourceId: input.sourceId ?? contact.sourceId,
        partnerId: input.partnerId,
        amount: input.amount,
        currency: input.amount ? ctx.tenant.currency : null,
        expectedCloseDate: input.expectedCloseDate,
        stageEnteredAt: now,
        closedAt: stage.category === 'won' ? now : null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: opportunities.id });
    if (!created) throw new AppError('INTERNAL', 'Could not save the record.');

    await tx.insert(stageHistory).values({
      tenantId: ctx.tenantId,
      opportunityId: created.id,
      stageId: stage.id,
      enteredAt: now,
      enteredBy: ctx.userId,
    });
    await recordSystemActivity(tx, ctx, {
      type: 'created',
      subject: `Opportunity created in ${stage.name}`,
      contactId: input.contactId,
      opportunityId: created.id,
    });
    await audit(tx, ctx, { action: 'create', entityType: 'opportunity', entityId: created.id });
    return created;
  });
}

export async function updateOpportunity(
  ctx: TenantContext,
  input: UpdateOpportunityInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'opportunities.edit');
  return withRls(ctx, async (tx) => {
    const existing = await loadForWrite(tx, ctx, input.id);
    assertCanAccess(ctx, 'opportunities.edit', existing);
    if (input.contactId !== existing.contactId)
      await assertContactVisible(tx, ctx, input.contactId);
    await assertPartnerExists(tx, ctx, input.partnerId);

    const ownerUserId = input.ownerUserId ?? existing.ownerUserId;
    if (ownerUserId !== existing.ownerUserId) {
      requirePermission(ctx, 'opportunities.assign');
      assertCanAccess(ctx, 'opportunities.assign', existing);
      assertCanAssign(ctx, ownerUserId);
    }
    // Without revenue.view the form never showed the amount, so it must not overwrite it.
    const canEditRevenue = hasPermission(ctx, 'revenue.view');
    const next = {
      name: input.name,
      contactId: input.contactId,
      organizationId: input.organizationId,
      amount: canEditRevenue ? input.amount : existing.amount,
      currency: canEditRevenue
        ? input.amount
          ? (existing.currency ?? ctx.tenant.currency)
          : null
        : existing.currency,
      expectedCloseDate: input.expectedCloseDate,
      ownerUserId,
      sourceId: input.sourceId,
      partnerId: input.partnerId,
    };
    const changes = diffChanges(existing, next);
    if (Object.keys(changes).length === 0) return { id: existing.id };

    await tx
      .update(opportunities)
      .set({ ...next, updatedBy: ctx.userId })
      .where(and(eq(opportunities.tenantId, ctx.tenantId), eq(opportunities.id, existing.id)));

    const { ownerUserId: ownerChange, ...fieldChanges } = changes;
    if (Object.keys(fieldChanges).length > 0) {
      await audit(tx, ctx, {
        action: 'update',
        entityType: 'opportunity',
        entityId: existing.id,
        changes: fieldChanges,
      });
    }
    if (ownerChange) {
      await recordSystemActivity(tx, ctx, {
        type: 'owner_changed',
        subject: 'Owner changed',
        contactId: existing.contactId,
        opportunityId: existing.id,
        metadata: { from: ownerChange[0], to: ownerChange[1] },
      });
      await audit(tx, ctx, {
        action: 'owner_change',
        entityType: 'opportunity',
        entityId: existing.id,
        changes: { ownerUserId: ownerChange },
      });
    }
    return { id: existing.id };
  });
}

/**
 * docs/database.md §10: close the current stage visit, open a new one, sync status and
 * closed_at, record a stage_changed activity and an audit row — all in one transaction.
 * Moving to a lost stage needs a reason; moving out of won/lost reopens.
 */
export async function moveStage(
  ctx: TenantContext,
  input: MoveStageInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'opportunities.edit');
  return withRls(ctx, async (tx) => {
    const existing = await loadForWrite(tx, ctx, input.id);
    assertCanAccess(ctx, 'opportunities.edit', existing);
    if (existing.stageId === input.stageId) return { id: existing.id };

    const [target] = await tx
      .select()
      .from(pipelineStages)
      .where(
        and(
          eq(pipelineStages.tenantId, ctx.tenantId),
          eq(pipelineStages.id, input.stageId),
          eq(pipelineStages.pipelineId, existing.pipelineId),
          eq(pipelineStages.isActive, true),
        ),
      )
      .limit(1);
    if (!target) throw new AppError('VALIDATION', 'That stage isn’t part of this pipeline.');

    let lostReasonId: string | null = null;
    if (target.category === 'lost') {
      if (!input.lostReasonId) {
        throw new AppError('VALIDATION', 'Choose why it was lost.', { lostReasonId: ['Required'] });
      }
      const [reason] = await tx
        .select({ id: lostReasons.id })
        .from(lostReasons)
        .where(and(eq(lostReasons.tenantId, ctx.tenantId), eq(lostReasons.id, input.lostReasonId)))
        .limit(1);
      if (!reason)
        throw new AppError('VALIDATION', 'Choose why it was lost.', { lostReasonId: ['Invalid'] });
      lostReasonId = reason.id;
    }

    const [from] = await tx
      .select({ name: pipelineStages.name })
      .from(pipelineStages)
      .where(
        and(eq(pipelineStages.tenantId, ctx.tenantId), eq(pipelineStages.id, existing.stageId)),
      )
      .limit(1);

    const now = new Date();
    const closed = target.category !== 'open';
    await tx
      .update(opportunities)
      .set({
        stageId: target.id,
        status: target.category,
        stageEnteredAt: now,
        closedAt: closed ? now : null,
        lostReasonId,
        lostReasonNote: target.category === 'lost' ? input.lostReasonNote : null,
        updatedBy: ctx.userId,
      })
      .where(and(eq(opportunities.tenantId, ctx.tenantId), eq(opportunities.id, existing.id)));

    await tx
      .update(stageHistory)
      .set({ exitedAt: now })
      .where(
        and(
          eq(stageHistory.tenantId, ctx.tenantId),
          eq(stageHistory.opportunityId, existing.id),
          isNull(stageHistory.exitedAt),
        ),
      );
    await tx.insert(stageHistory).values({
      tenantId: ctx.tenantId,
      opportunityId: existing.id,
      stageId: target.id,
      enteredAt: now,
      enteredBy: ctx.userId,
    });

    await recordSystemActivity(tx, ctx, {
      type: 'stage_changed',
      subject: `Moved from ${from?.name ?? 'previous stage'} to ${target.name}`,
      contactId: existing.contactId,
      opportunityId: existing.id,
      metadata: { fromStageId: existing.stageId, toStageId: target.id },
    });
    await audit(tx, ctx, {
      action: 'stage_change',
      entityType: 'opportunity',
      entityId: existing.id,
      changes: { stageId: [existing.stageId, target.id] },
      context: lostReasonId ? { lostReasonId } : null,
    });
    return { id: existing.id };
  });
}

export async function deleteOpportunity(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'opportunities.delete');
  return withRls(ctx, async (tx) => {
    const existing = await loadForWrite(tx, ctx, id);
    assertCanAccess(ctx, 'opportunities.delete', existing);
    await tx
      .update(opportunities)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(opportunities.tenantId, ctx.tenantId), eq(opportunities.id, id)));
    await audit(tx, ctx, { action: 'delete', entityType: 'opportunity', entityId: id });
    return { id };
  });
}

/** Keeps opportunities.next_task_due_at equal to its earliest open task (database.md §10). */
export async function refreshNextTaskDue(
  tx: Tx,
  ctx: TenantContext,
  opportunityId: string,
): Promise<void> {
  const [next] = await tx
    .select({ due: min(tasks.dueAt) })
    .from(tasks)
    .where(
      and(
        eq(tasks.tenantId, ctx.tenantId),
        eq(tasks.opportunityId, opportunityId),
        eq(tasks.status, 'open'),
        isNull(tasks.deletedAt),
      ),
    );
  await tx
    .update(opportunities)
    .set({ nextTaskDueAt: next?.due ?? null })
    .where(and(eq(opportunities.tenantId, ctx.tenantId), eq(opportunities.id, opportunityId)));
}
