import 'server-only';

import { and, eq, isNull, max } from 'drizzle-orm';

import { lostReasons, opportunityItems, organizations, stageHistory } from '@/db/schema';
import { diffChanges } from '@/lib/audit-diff';
import { AppError } from '@/lib/errors';
import { assertCanAccess, canAccess } from '@/lib/permissions/scope';
import { recordSystemActivity } from '@/modules/activities/service';
import { loadCustomFields } from '@/modules/custom-fields/queries';
import { cleanCustomFields } from '@/modules/custom-fields/validation';
import { deliverEmails, type PendingEmail } from '@/modules/notifications/service';
import { loadItemPipelineFor, loadPipelineConfig, type Stage } from '@/modules/pipelines/queries';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import { expectedRevenueFrom } from './item-revenue';
import type { CreateItemInput, MoveItemStageInput, UpdateItemInput } from './schemas';
import {
  advanceFromItem,
  assertCanAssign,
  loadForWrite as loadOpportunityForWrite,
  type ParentAdvance,
} from './service';

// Opportunity items (ADR-018). An item has no access rules of its own: viewing, adding, changing
// and moving one needs that permission on its opportunity, within record scope; removing one
// needs opportunities.delete on it (docs/permissions.md).

export type ItemResult = { id: string; parentAdvance: ParentAdvance | null };

/**
 * The item and its opportunity, both locked. The opportunity is locked first, as every
 * opportunity write does, so an item move and a move of its opportunity cannot deadlock.
 */
async function loadItemForWrite(tx: Tx, ctx: TenantContext, id: string) {
  const [found] = await tx
    .select({ opportunityId: opportunityItems.opportunityId })
    .from(opportunityItems)
    .where(
      and(
        eq(opportunityItems.tenantId, ctx.tenantId),
        eq(opportunityItems.id, id),
        isNull(opportunityItems.deletedAt),
      ),
    )
    .limit(1);
  if (!found) throw new AppError('NOT_FOUND', 'That record was not found.');
  const parent = await loadOpportunityForWrite(tx, ctx, found.opportunityId);
  const [item] = await tx
    .select()
    .from(opportunityItems)
    .where(
      and(
        eq(opportunityItems.tenantId, ctx.tenantId),
        eq(opportunityItems.id, id),
        isNull(opportunityItems.deletedAt),
      ),
    )
    .limit(1)
    .for('update');
  if (!item) throw new AppError('NOT_FOUND', 'That record was not found.');
  return { item, parent };
}

async function assertOrganization(tx: Tx, ctx: TenantContext, organizationId: string) {
  const [organization] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      and(
        eq(organizations.tenantId, ctx.tenantId),
        eq(organizations.id, organizationId),
        isNull(organizations.deletedAt),
      ),
    )
    .limit(1);
  if (!organization) {
    throw new AppError('VALIDATION', 'Choose who it is with.', { organizationId: ['Not found'] });
  }
}

async function cleanItemCustomFields(
  tx: Tx,
  ctx: TenantContext,
  submitted: Record<string, unknown>,
  existing?: Record<string, unknown>,
) {
  const definitions = await loadCustomFields(tx, ctx.tenantId, 'opportunity_item');
  const custom = cleanCustomFields(definitions, submitted, existing);
  if (Object.keys(custom.errors).length > 0) {
    throw new AppError('VALIDATION', 'Check the highlighted fields.', custom.errors);
  }
  return custom.values;
}

/** The money fields as they will be stored: expected revenue falls back to base × rate. */
function revenueOf(
  ctx: TenantContext,
  input: Pick<CreateItemInput, 'baseAmount' | 'revenueRate' | 'expectedRevenue' | 'currency'>,
) {
  const expectedRevenue =
    input.expectedRevenue ?? expectedRevenueFrom(input.baseAmount, input.revenueRate);
  const hasMoney = input.baseAmount !== null || expectedRevenue !== null;
  return {
    baseAmount: input.baseAmount,
    revenueRate: input.revenueRate,
    expectedRevenue,
    currency: hasMoney ? (input.currency ?? ctx.tenant.currency) : null,
  };
}

async function closeOpenVisit(tx: Tx, ctx: TenantContext, itemId: string, at: Date) {
  await tx
    .update(stageHistory)
    .set({ exitedAt: at })
    .where(
      and(
        eq(stageHistory.tenantId, ctx.tenantId),
        eq(stageHistory.opportunityItemId, itemId),
        isNull(stageHistory.exitedAt),
      ),
    );
}

/** An item entering `stage` moves its opportunity forward when the stage says so. */
async function followStage(
  tx: Tx,
  ctx: TenantContext,
  opportunityId: string,
  stage: Stage,
): Promise<{ advance: ParentAdvance | null; emails: PendingEmail[] }> {
  if (!stage.advancesParentToStageId) return { advance: null, emails: [] };
  return advanceFromItem(tx, ctx, opportunityId, stage.advancesParentToStageId);
}

export async function createItem(ctx: TenantContext, input: CreateItemInput): Promise<ItemResult> {
  requirePermission(ctx, 'opportunities.edit');
  const outcome = await withRls(ctx, async (tx) => {
    const parent = await loadOpportunityForWrite(tx, ctx, input.opportunityId);
    assertCanAccess(ctx, 'opportunities.edit', parent);
    const labels = ctx.tenant.labels;

    const pipeline = await loadItemPipelineFor(tx, ctx, parent.pipelineId);
    if (!pipeline) {
      throw new AppError(
        'VALIDATION',
        `Set up a pipeline for ${labels.opportunityItem.plural.toLowerCase()} in Settings first.`,
      );
    }
    const stage = input.stageId
      ? pipeline.stages.find((candidate) => candidate.id === input.stageId && candidate.isActive)
      : pipeline.stages.find((candidate) => candidate.category === 'open' && candidate.isActive);
    if (!stage || stage.category !== 'open') {
      throw new AppError(
        'VALIDATION',
        `A new ${labels.opportunityItem.singular.toLowerCase()} starts in an open stage.`,
        {
          stageId: ['Choose an open stage'],
        },
      );
    }
    await assertOrganization(tx, ctx, input.organizationId);

    const ownerUserId = input.ownerUserId ?? parent.ownerUserId;
    if (ownerUserId !== parent.ownerUserId) assertCanAssign(ctx, ownerUserId);
    // Revenue is entered only by someone who may see it on this opportunity.
    const revenue = canAccess(ctx, 'revenue.view', parent)
      ? revenueOf(ctx, input)
      : { baseAmount: null, revenueRate: null, expectedRevenue: null, currency: null };
    const customFields = await cleanItemCustomFields(tx, ctx, input.customFields);

    const [last] = await tx
      .select({ position: max(opportunityItems.position) })
      .from(opportunityItems)
      .where(
        and(
          eq(opportunityItems.tenantId, ctx.tenantId),
          eq(opportunityItems.opportunityId, parent.id),
        ),
      );
    const now = new Date();
    const [created] = await tx
      .insert(opportunityItems)
      .values({
        tenantId: ctx.tenantId,
        opportunityId: parent.id,
        organizationId: input.organizationId,
        title: input.title,
        pipelineId: pipeline.id,
        stageId: stage.id,
        status: 'open',
        stageEnteredAt: now,
        externalReference: input.externalReference,
        ...revenue,
        ownerUserId,
        customFields,
        position: last?.position === null || last?.position === undefined ? 0 : last.position + 1,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: opportunityItems.id });
    if (!created) throw new AppError('INTERNAL', 'Could not save the record.');

    await tx.insert(stageHistory).values({
      tenantId: ctx.tenantId,
      opportunityId: parent.id,
      opportunityItemId: created.id,
      stageId: stage.id,
      enteredAt: now,
      enteredBy: ctx.userId,
    });
    await recordSystemActivity(tx, ctx, {
      type: 'created',
      subject: `${labels.opportunityItem.singular} added: ${input.title}`.slice(0, 200),
      contactId: parent.contactId,
      opportunityId: parent.id,
      metadata: { itemId: created.id, stageId: stage.id },
    });
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'opportunity_item',
      entityId: created.id,
      context: { opportunityId: parent.id },
    });
    const followed = await followStage(tx, ctx, parent.id, stage);
    return { id: created.id, ...followed };
  });
  await deliverEmails(ctx, outcome.emails);
  return { id: outcome.id, parentAdvance: outcome.advance };
}

export async function updateItem(
  ctx: TenantContext,
  input: UpdateItemInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'opportunities.edit');
  return withRls(ctx, async (tx) => {
    const { item, parent } = await loadItemForWrite(tx, ctx, input.id);
    assertCanAccess(ctx, 'opportunities.edit', parent);
    if (input.organizationId !== item.organizationId) {
      await assertOrganization(tx, ctx, input.organizationId);
    }
    const ownerUserId = input.ownerUserId ?? item.ownerUserId;
    if (ownerUserId !== item.ownerUserId && ownerUserId !== parent.ownerUserId) {
      assertCanAssign(ctx, ownerUserId);
    }
    // Where revenue is masked the form never showed it, so it must not overwrite it.
    const revenue = canAccess(ctx, 'revenue.view', parent)
      ? revenueOf(ctx, { ...input, currency: input.currency ?? item.currency })
      : {
          baseAmount: item.baseAmount,
          revenueRate: item.revenueRate,
          expectedRevenue: item.expectedRevenue,
          currency: item.currency,
        };
    const customFields = await cleanItemCustomFields(
      tx,
      ctx,
      input.customFields,
      item.customFields as Record<string, unknown>,
    );
    const next = {
      organizationId: input.organizationId,
      title: input.title,
      externalReference: input.externalReference,
      ...revenue,
      ownerUserId,
      customFields,
    };
    const changes = diffChanges(item, next);
    if (Object.keys(changes).length === 0) return { id: item.id };
    await tx
      .update(opportunityItems)
      .set({ ...next, updatedBy: ctx.userId })
      .where(and(eq(opportunityItems.tenantId, ctx.tenantId), eq(opportunityItems.id, item.id)));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'opportunity_item',
      entityId: item.id,
      changes,
      context: { opportunityId: parent.id },
    });
    return { id: item.id };
  });
}

/**
 * Moves one item to another stage of its own pipeline: closes its current visit and opens the
 * next, keeps status and closed_at in step, records it on the opportunity's timeline and audits
 * it. A lost stage needs a reason. Item stages carry no gates of their own; entering one may move
 * the opportunity forward (advanceFromItem), which keeps the opportunity's gates.
 */
export async function moveItemStage(
  ctx: TenantContext,
  input: MoveItemStageInput,
): Promise<ItemResult> {
  requirePermission(ctx, 'opportunities.edit');
  const outcome = await withRls(ctx, async (tx) => {
    const { item, parent } = await loadItemForWrite(tx, ctx, input.id);
    assertCanAccess(ctx, 'opportunities.edit', parent);
    if (item.stageId === input.stageId) return { id: item.id, advance: null, emails: [] };

    const pipeline = await loadPipelineConfig(tx, ctx, item.pipelineId, 'opportunity_item');
    const target = pipeline.stages.find((stage) => stage.id === input.stageId && stage.isActive);
    if (!target) throw new AppError('VALIDATION', 'That stage isn’t part of this pipeline.');
    const current = pipeline.stages.find((stage) => stage.id === item.stageId);

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
      if (!reason) {
        throw new AppError('VALIDATION', 'Choose why it was lost.', { lostReasonId: ['Invalid'] });
      }
      lostReasonId = reason.id;
    }

    const now = new Date();
    await tx
      .update(opportunityItems)
      .set({
        stageId: target.id,
        status: target.category,
        stageEnteredAt: now,
        closedAt: target.category === 'open' ? null : now,
        lostReasonId,
        lostReasonNote: target.category === 'lost' ? input.lostReasonNote : null,
        updatedBy: ctx.userId,
      })
      .where(and(eq(opportunityItems.tenantId, ctx.tenantId), eq(opportunityItems.id, item.id)));
    await closeOpenVisit(tx, ctx, item.id, now);
    await tx.insert(stageHistory).values({
      tenantId: ctx.tenantId,
      opportunityId: parent.id,
      opportunityItemId: item.id,
      stageId: target.id,
      enteredAt: now,
      enteredBy: ctx.userId,
    });
    await recordSystemActivity(tx, ctx, {
      type: 'stage_changed',
      subject:
        `${item.title}: moved from ${current?.name ?? 'previous stage'} to ${target.name}`.slice(
          0,
          200,
        ),
      contactId: parent.contactId,
      opportunityId: parent.id,
      metadata: { itemId: item.id, fromStageId: item.stageId, toStageId: target.id },
    });
    await audit(tx, ctx, {
      action: 'stage_change',
      entityType: 'opportunity_item',
      entityId: item.id,
      changes: { stageId: [item.stageId, target.id] },
      context: { opportunityId: parent.id, ...(lostReasonId ? { lostReasonId } : {}) },
    });
    const followed = await followStage(tx, ctx, parent.id, target);
    return { id: item.id, ...followed };
  });
  await deliverEmails(ctx, outcome.emails);
  return { id: outcome.id, parentAdvance: outcome.advance };
}

export async function deleteItem(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'opportunities.delete');
  return withRls(ctx, async (tx) => {
    const { item, parent } = await loadItemForWrite(tx, ctx, id);
    assertCanAccess(ctx, 'opportunities.delete', parent);
    const now = new Date();
    await tx
      .update(opportunityItems)
      .set({ deletedAt: now, updatedBy: ctx.userId })
      .where(and(eq(opportunityItems.tenantId, ctx.tenantId), eq(opportunityItems.id, item.id)));
    await audit(tx, ctx, {
      action: 'delete',
      entityType: 'opportunity_item',
      entityId: item.id,
      context: { opportunityId: parent.id },
    });
    return { id: item.id };
  });
}
