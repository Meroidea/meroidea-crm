import 'server-only';

import { and, eq, inArray, isNull, min } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  contacts,
  lostReasons,
  opportunities,
  opportunityContacts,
  partners,
  pipelineStages,
  rolePermissions,
  stageApprovals,
  stageHistory,
  tasks,
  teams,
  tenantMemberships,
} from '@/db/schema';
import { diffChanges } from '@/lib/audit-diff';
import { AppError } from '@/lib/errors';
import { assertCanAccess, canAccess, scopeDecision } from '@/lib/permissions/scope';
import { recordSystemActivity } from '@/modules/activities/service';
import { contactRecord } from '@/modules/contacts/access';
import { loadCustomFields } from '@/modules/custom-fields/queries';
import { cleanCustomFields } from '@/modules/custom-fields/validation';
import { nextInTurn } from '@/modules/leads/routing';
import {
  deliverEmails,
  notify,
  type NoticeInput,
  type PendingEmail,
} from '@/modules/notifications/service';
import { loadPipelineConfig, type PipelineConfig, type Stage } from '@/modules/pipelines/queries';
import { audit } from '@/server/audit';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import { missingFields, opportunityFieldLabel } from './fields';
import type {
  ChecklistInput,
  CreateOpportunityInput,
  MoveStageInput,
  OpportunityContactInput,
  UpdateOpportunityInput,
} from './schemas';

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
    .select({
      ownerUserId: contacts.ownerUserId,
      originatorUserId: contacts.originatorUserId,
      handoverToUserId: contacts.handoverToUserId,
      sourceId: contacts.sourceId,
      subSourceId: contacts.subSourceId,
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
  if (!contact)
    throw new AppError('VALIDATION', 'Choose who this is for.', { contactId: ['Not found'] });
  assertCanAccess(ctx, 'contacts.view', contactRecord(contact));
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

async function customLabels(tx: Tx, tenantId: string): Promise<Record<string, string>> {
  const fields = await loadCustomFields(tx, tenantId, 'opportunity');
  return Object.fromEntries(fields.map((field) => [field.key, field.label]));
}

/** Fields an opportunity must have before it can enter `stage`, as a validation error. */
async function assertRequiredFields(
  tx: Tx,
  ctx: TenantContext,
  stage: Stage,
  record: Record<string, unknown> & { customFields?: unknown },
): Promise<void> {
  const missing = missingFields(stage.requiredFields, record);
  if (missing.length === 0) return;
  const labels = await customLabels(tx, ctx.tenantId);
  const names = missing.map((ref) => opportunityFieldLabel(ref, labels));
  throw new AppError(
    'VALIDATION',
    `Before moving to ${stage.name}, fill in: ${names.join(', ')}.`,
    Object.fromEntries(missing.map((ref) => [ref.replace('custom:', 'custom.'), ['Required']])),
  );
}

function assertChecklistDone(stage: Stage, state: unknown): void {
  if (stage.checklist.length === 0) return;
  const done = ((state ?? {}) as Record<string, string[]>)[stage.id] ?? [];
  const open = stage.checklist.filter((item) => !done.includes(item.id));
  if (open.length > 0) {
    throw new AppError(
      'VALIDATION',
      `Finish the ${stage.name} checklist first: ${open.map((item) => item.label).join(', ')}.`,
    );
  }
}

/**
 * What happens when an opportunity enters a stage that has an owner (docs/leads.md §4.8): the
 * owner — a person, or the next member of a team in turn — is told, made the opportunity's owner,
 * or given a task, depending on the stage. The previous owner stays in the timeline.
 */
async function enterStageOwner(
  tx: Tx,
  ctx: TenantContext,
  opportunity: { id: string; name: string; contactId: string; ownerUserId: string | null },
  stage: Stage,
): Promise<{ ownerUserId: string | null; notices: NoticeInput[] }> {
  let assignee = stage.ownerUserId;
  if (!assignee && stage.ownerTeamId) {
    const members = await tx
      .select({ userId: tenantMemberships.userId })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, ctx.tenantId),
          eq(tenantMemberships.teamId, stage.ownerTeamId),
          eq(tenantMemberships.status, 'active'),
          eq(tenantMemberships.isSupport, false),
        ),
      );
    const pool = members.map((member) => member.userId).sort();
    const [current] = await tx
      .select({ last: pipelineStages.lastAssignedUserId })
      .from(pipelineStages)
      .where(and(eq(pipelineStages.tenantId, ctx.tenantId), eq(pipelineStages.id, stage.id)))
      .limit(1)
      .for('update');
    assignee = nextInTurn(pool, current?.last ?? null);
    if (assignee) {
      await tx
        .update(pipelineStages)
        .set({ lastAssignedUserId: assignee })
        .where(and(eq(pipelineStages.tenantId, ctx.tenantId), eq(pipelineStages.id, stage.id)));
    }
  }
  if (!assignee) return { ownerUserId: opportunity.ownerUserId, notices: [] };

  const url = `/opportunities/${opportunity.id}`;
  if (stage.onEnter === 'reassign' && assignee !== opportunity.ownerUserId) {
    await recordSystemActivity(tx, ctx, {
      type: 'owner_changed',
      subject: `Handed to the ${stage.name} owner`,
      contactId: opportunity.contactId,
      opportunityId: opportunity.id,
      metadata: { from: opportunity.ownerUserId, to: assignee, stageId: stage.id },
    });
    await audit(tx, ctx, {
      action: 'owner_change',
      entityType: 'opportunity',
      entityId: opportunity.id,
      changes: { ownerUserId: [opportunity.ownerUserId, assignee] },
      context: { stageId: stage.id },
    });
  }
  if (stage.onEnter === 'task') {
    const due = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await tx.insert(tasks).values({
      tenantId: ctx.tenantId,
      title: `${stage.name}: ${opportunity.name}`.slice(0, 200),
      type: 'follow_up',
      dueAt: due,
      assignedTo: assignee,
      contactId: opportunity.contactId,
      opportunityId: opportunity.id,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });
  }
  return {
    ownerUserId: stage.onEnter === 'reassign' ? assignee : opportunity.ownerUserId,
    notices: [
      {
        userId: assignee,
        type: 'stage_assigned',
        title: `${opportunity.name} moved to ${stage.name}`,
        url,
        email: true,
      },
    ],
  };
}

export type OpenOpportunityInput = {
  contactId: string;
  organizationId: string | null;
  name: string;
  pipelineId: string | null;
  stageId: string | null;
  ownerUserId: string | null;
  sourceId: string | null;
  subSourceId: string | null;
  originatorUserId: string | null;
  partnerId: string | null;
  amount: string | null;
  expectedCloseDate: string | null;
  product: string | null;
  probability: number | null;
  nextStep: string | null;
  customFields: Record<string, unknown>;
};

/**
 * Creates an opportunity with its first stage visit, timeline entry and audit row, inside the
 * caller's transaction. Used by the new-opportunity form and by lead conversion. Returns the
 * notices to send once the transaction commits.
 */
export async function openOpportunity(
  tx: Tx,
  ctx: TenantContext,
  input: OpenOpportunityInput,
): Promise<{ id: string; emails: PendingEmail[] }> {
  const pipeline = await loadPipelineConfig(tx, ctx, input.pipelineId);
  if (!pipeline.isActive) {
    throw new AppError('VALIDATION', 'That pipeline is switched off.', { pipelineId: ['Invalid'] });
  }
  const stage = input.stageId
    ? pipeline.stages.find((candidate) => candidate.id === input.stageId && candidate.isActive)
    : pipeline.stages.find((candidate) => candidate.category === 'open' && candidate.isActive);
  if (!stage)
    throw new AppError('VALIDATION', 'Choose a stage in this pipeline.', {
      stageId: ['Invalid stage'],
    });
  // A new opportunity starts in an open stage, by the same rules as moving into one: a closed
  // stage would skip the checklist and win/loss rules, and a stage that needs a manager's
  // approval may be started in only by someone who could approve it.
  if (stage.category !== 'open') {
    throw new AppError('VALIDATION', 'A new opportunity starts in an open stage.', {
      stageId: ['Choose an open stage'],
    });
  }
  if (stage.requiresApproval && !hasPermission(ctx, 'opportunities.approve')) {
    throw new AppError(
      'VALIDATION',
      `Moving into ${stage.name} needs a manager’s approval. Start in an earlier stage and move it there.`,
      { stageId: ['Needs approval'] },
    );
  }
  await assertRequiredFields(tx, ctx, stage, { ...input });

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
      ownerUserId: input.ownerUserId,
      sourceId: input.sourceId,
      subSourceId: input.subSourceId,
      originatorUserId: input.originatorUserId,
      partnerId: input.partnerId,
      amount: input.amount,
      currency: input.amount ? ctx.tenant.currency : null,
      expectedCloseDate: input.expectedCloseDate,
      product: input.product,
      probability: input.probability,
      nextStep: input.nextStep,
      customFields: input.customFields,
      stageEnteredAt: now,
      closedAt: null,
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
    subject: `${ctx.tenant.labels.opportunity.singular} created in ${stage.name}`,
    contactId: input.contactId,
    opportunityId: created.id,
  });
  await audit(tx, ctx, { action: 'create', entityType: 'opportunity', entityId: created.id });

  const entry = await enterStageOwner(
    tx,
    ctx,
    {
      id: created.id,
      name: input.name,
      contactId: input.contactId,
      ownerUserId: input.ownerUserId,
    },
    stage,
  );
  if (entry.ownerUserId !== input.ownerUserId) {
    await tx
      .update(opportunities)
      .set({ ownerUserId: entry.ownerUserId })
      .where(and(eq(opportunities.tenantId, ctx.tenantId), eq(opportunities.id, created.id)));
  }
  if (stage.onEnter === 'task') await refreshNextTaskDue(tx, ctx, created.id);
  const emails = await notify(tx, ctx, entry.notices);
  return { id: created.id, emails };
}

export async function createOpportunity(
  ctx: TenantContext,
  input: CreateOpportunityInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'opportunities.create');
  const ownerUserId = input.ownerUserId ?? ctx.userId;
  assertCanAssign(ctx, ownerUserId);

  const result = await withRls(ctx, async (tx) => {
    const contact = await assertContactVisible(tx, ctx, input.contactId);
    await assertPartnerExists(tx, ctx, input.partnerId);
    const definitions = await loadCustomFields(tx, ctx.tenantId, 'opportunity');
    const custom = cleanCustomFields(definitions, input.customFields);
    if (Object.keys(custom.errors).length > 0) {
      throw new AppError('VALIDATION', 'Check the highlighted fields.', custom.errors);
    }
    const sourceId = input.sourceId ?? contact.sourceId;
    return openOpportunity(tx, ctx, {
      contactId: input.contactId,
      organizationId: input.organizationId,
      name: input.name,
      pipelineId: input.pipelineId,
      stageId: input.stageId,
      ownerUserId,
      sourceId,
      subSourceId: sourceId === contact.sourceId ? contact.subSourceId : null,
      originatorUserId: contact.originatorUserId,
      partnerId: input.partnerId,
      amount: hasPermission(ctx, 'revenue.view') ? input.amount : null,
      expectedCloseDate: input.expectedCloseDate,
      product: input.product,
      probability: input.probability,
      nextStep: input.nextStep,
      customFields: custom.values,
    });
  });
  await deliverEmails(ctx, result.emails);
  return { id: result.id };
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
    const definitions = await loadCustomFields(tx, ctx.tenantId, 'opportunity');
    const custom = cleanCustomFields(
      definitions,
      input.customFields,
      existing.customFields as Record<string, unknown>,
    );
    if (Object.keys(custom.errors).length > 0) {
      throw new AppError('VALIDATION', 'Check the highlighted fields.', custom.errors);
    }
    // Where the amount was masked (revenue.view not reaching this record), the form never showed
    // it, so it must not overwrite it: the same per-record rule as the read.
    const canEditRevenue = canAccess(ctx, 'revenue.view', existing);
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
      subSourceId: input.sourceId === existing.sourceId ? existing.subSourceId : null,
      partnerId: input.partnerId,
      product: input.product,
      probability: input.probability,
      nextStep: input.nextStep,
      customFields: custom.values,
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
 * People who may approve this opportunity's stage move: members whose role grants
 * opportunities.approve and whose opportunities.view scope reaches it — everyone's, or the
 * owner's team when they share or manage it. Nobody is asked about a deal they cannot open.
 */
async function approverIds(
  tx: Tx,
  ctx: TenantContext,
  ownerUserId: string | null,
): Promise<string[]> {
  const approve = alias(rolePermissions, 'approve_grant');
  const view = alias(rolePermissions, 'view_grant');
  const rows = await tx
    .select({
      userId: tenantMemberships.userId,
      teamId: tenantMemberships.teamId,
      viewScope: view.scope,
    })
    .from(tenantMemberships)
    .innerJoin(
      approve,
      and(
        eq(approve.tenantId, tenantMemberships.tenantId),
        eq(approve.roleId, tenantMemberships.roleId),
        eq(approve.permission, 'opportunities.approve'),
      ),
    )
    .innerJoin(
      view,
      and(
        eq(view.tenantId, tenantMemberships.tenantId),
        eq(view.roleId, tenantMemberships.roleId),
        eq(view.permission, 'opportunities.view'),
      ),
    )
    .where(
      and(
        eq(tenantMemberships.tenantId, ctx.tenantId),
        eq(tenantMemberships.status, 'active'),
        eq(tenantMemberships.isSupport, false),
      ),
    );
  if (!ownerUserId) return rows.filter((row) => row.viewScope === 'all').map((row) => row.userId);

  const [owner] = await tx
    .select({ teamId: tenantMemberships.teamId })
    .from(tenantMemberships)
    .where(
      and(eq(tenantMemberships.tenantId, ctx.tenantId), eq(tenantMemberships.userId, ownerUserId)),
    )
    .limit(1);
  const managed = owner?.teamId
    ? await tx
        .select({ managerUserId: teams.managerUserId })
        .from(teams)
        .where(and(eq(teams.tenantId, ctx.tenantId), eq(teams.id, owner.teamId)))
    : [];
  return rows
    .filter(
      (row) =>
        row.viewScope === 'all' ||
        row.userId === ownerUserId ||
        (row.viewScope === 'team' &&
          ((owner?.teamId && row.teamId === owner.teamId) ||
            managed.some((team) => team.managerUserId === row.userId))),
    )
    .map((row) => row.userId);
}

type MoveResult = { id: string; pendingApproval: boolean };

/**
 * docs/database.md §10 and docs/leads.md §4.8: close the current stage visit, open a new one,
 * sync status and closed_at, record a stage_changed activity and an audit row — all in one
 * transaction. Moving forward checks the stage gates first: the target's required fields and the
 * current stage's checklist. A stage that needs approval turns the move into a request unless the
 * mover may approve. Moving to a lost stage needs a reason; moving out of won/lost reopens.
 */
async function performMove(
  tx: Tx,
  ctx: TenantContext,
  existing: Awaited<ReturnType<typeof loadForWrite>>,
  pipeline: PipelineConfig,
  input: MoveStageInput,
  options: { approved: boolean },
): Promise<{ result: MoveResult; emails: PendingEmail[] }> {
  const target = pipeline.stages.find((stage) => stage.id === input.stageId && stage.isActive);
  if (!target) throw new AppError('VALIDATION', 'That stage isn’t part of this pipeline.');
  const current = pipeline.stages.find((stage) => stage.id === existing.stageId);

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
  } else {
    const forward = !current || target.position > current.position;
    if (forward) {
      if (current && current.category === 'open')
        assertChecklistDone(current, existing.checklistState);
      await assertRequiredFields(tx, ctx, target, existing);
    }
    if (
      target.requiresApproval &&
      !options.approved &&
      !hasPermission(ctx, 'opportunities.approve')
    ) {
      const [request] = await tx
        .insert(stageApprovals)
        .values({
          tenantId: ctx.tenantId,
          opportunityId: existing.id,
          stageId: target.id,
          note: input.lostReasonNote,
          requestedBy: ctx.userId,
        })
        .onConflictDoNothing()
        .returning({ id: stageApprovals.id });
      if (!request) {
        throw new AppError('CONFLICT', 'An approval is already waiting for this opportunity.');
      }
      await recordSystemActivity(tx, ctx, {
        type: 'approval',
        subject: `Asked for approval to move to ${target.name}`,
        contactId: existing.contactId,
        opportunityId: existing.id,
        metadata: { approvalId: request.id, stageId: target.id },
      });
      await audit(tx, ctx, {
        action: 'create',
        entityType: 'stage_approval',
        entityId: request.id,
        context: { opportunityId: existing.id, stageId: target.id },
      });
      const approvers = await approverIds(tx, ctx, existing.ownerUserId);
      const emails = await notify(
        tx,
        ctx,
        approvers.map((userId) => ({
          userId,
          type: 'approval_requested',
          title: `${existing.name} needs approval to move to ${target.name}`,
          url: `/opportunities/${existing.id}`,
          email: true,
        })),
      );
      return { result: { id: existing.id, pendingApproval: true }, emails };
    }
  }

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
    subject: `Moved from ${current?.name ?? 'previous stage'} to ${target.name}`,
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

  // A request to move it somewhere else no longer stands once it has been moved: approving it
  // later would undo this move (and could reopen a lost deal).
  if (!options.approved) {
    const stale = await tx
      .update(stageApprovals)
      .set({ status: 'withdrawn', decidedBy: ctx.userId, decidedAt: now })
      .where(
        and(
          eq(stageApprovals.tenantId, ctx.tenantId),
          eq(stageApprovals.opportunityId, existing.id),
          eq(stageApprovals.status, 'pending'),
        ),
      )
      .returning({ id: stageApprovals.id });
    for (const request of stale) {
      await audit(tx, ctx, {
        action: 'update',
        entityType: 'stage_approval',
        entityId: request.id,
        changes: { status: ['pending', 'withdrawn'] },
        context: { reason: 'moved' },
      });
    }
  }

  const entry = await enterStageOwner(tx, ctx, existing, target);
  if (entry.ownerUserId !== existing.ownerUserId) {
    await tx
      .update(opportunities)
      .set({ ownerUserId: entry.ownerUserId })
      .where(and(eq(opportunities.tenantId, ctx.tenantId), eq(opportunities.id, existing.id)));
  }
  if (target.onEnter === 'task') await refreshNextTaskDue(tx, ctx, existing.id);
  const emails = await notify(tx, ctx, entry.notices);
  return { result: { id: existing.id, pendingApproval: false }, emails };
}

export async function moveStage(ctx: TenantContext, input: MoveStageInput): Promise<MoveResult> {
  requirePermission(ctx, 'opportunities.edit');
  const outcome = await withRls(ctx, async (tx) => {
    const existing = await loadForWrite(tx, ctx, input.id);
    assertCanAccess(ctx, 'opportunities.edit', existing);
    if (existing.stageId === input.stageId) {
      return { result: { id: existing.id, pendingApproval: false }, emails: [] };
    }
    const pipeline = await loadPipelineConfig(tx, ctx, existing.pipelineId);
    return performMove(tx, ctx, existing, pipeline, input, { approved: false });
  });
  await deliverEmails(ctx, outcome.emails);
  return outcome.result;
}

/** A manager answers a stage approval request; approving makes the move (gates still apply). */
export async function decideApproval(
  ctx: TenantContext,
  input: { approvalId: string; approve: boolean; note: string | null },
): Promise<{ id: string }> {
  requirePermission(ctx, 'opportunities.approve');
  const outcome = await withRls(ctx, async (tx) => {
    const [request] = await tx
      .select()
      .from(stageApprovals)
      .where(
        and(eq(stageApprovals.tenantId, ctx.tenantId), eq(stageApprovals.id, input.approvalId)),
      )
      .limit(1)
      .for('update');
    if (!request || request.status !== 'pending') {
      throw new AppError('NOT_FOUND', 'That request was not found or has been answered.');
    }
    const existing = await loadForWrite(tx, ctx, request.opportunityId);
    assertCanAccess(ctx, 'opportunities.view', existing);

    let emails: PendingEmail[] = [];
    if (input.approve) {
      if (existing.status !== 'open') {
        throw new AppError(
          'CONFLICT',
          'This opportunity has been closed since the request. Decline the request instead.',
        );
      }
      const pipeline = await loadPipelineConfig(tx, ctx, existing.pipelineId);
      const moved = await performMove(
        tx,
        ctx,
        existing,
        pipeline,
        { id: existing.id, stageId: request.stageId, lostReasonId: null, lostReasonNote: null },
        { approved: true },
      );
      emails = moved.emails;
    }
    await tx
      .update(stageApprovals)
      .set({
        status: input.approve ? 'approved' : 'declined',
        decidedBy: ctx.userId,
        decidedAt: new Date(),
        decisionNote: input.note,
      })
      .where(and(eq(stageApprovals.tenantId, ctx.tenantId), eq(stageApprovals.id, request.id)));
    await recordSystemActivity(tx, ctx, {
      type: 'approval',
      subject: input.approve ? 'Stage move approved' : 'Stage move declined',
      body: input.note,
      contactId: existing.contactId,
      opportunityId: existing.id,
      metadata: { approvalId: request.id, stageId: request.stageId },
    });
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'stage_approval',
      entityId: request.id,
      changes: { status: ['pending', input.approve ? 'approved' : 'declined'] },
    });
    emails.push(
      ...(await notify(tx, ctx, [
        {
          userId: request.requestedBy,
          type: 'approval_decided',
          title: `${existing.name}: your request was ${input.approve ? 'approved' : 'declined'}`,
          url: `/opportunities/${existing.id}`,
          email: true,
        },
      ])),
    );
    return { emails };
  });
  await deliverEmails(ctx, outcome.emails);
  return { id: input.approvalId };
}

/** The requester (or an approver) withdraws a waiting approval request. */
export async function withdrawApproval(ctx: TenantContext, approvalId: string) {
  requirePermission(ctx, 'opportunities.edit');
  return withRls(ctx, async (tx) => {
    const [request] = await tx
      .select()
      .from(stageApprovals)
      .where(and(eq(stageApprovals.tenantId, ctx.tenantId), eq(stageApprovals.id, approvalId)))
      .limit(1)
      .for('update');
    if (!request || request.status !== 'pending') {
      throw new AppError('NOT_FOUND', 'That request was not found or has been answered.');
    }
    if (request.requestedBy !== ctx.userId && !hasPermission(ctx, 'opportunities.approve')) {
      throw new AppError('FORBIDDEN', 'Only the person who asked can withdraw this.');
    }
    await tx
      .update(stageApprovals)
      .set({ status: 'withdrawn', decidedBy: ctx.userId, decidedAt: new Date() })
      .where(and(eq(stageApprovals.tenantId, ctx.tenantId), eq(stageApprovals.id, approvalId)));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'stage_approval',
      entityId: approvalId,
      changes: { status: ['pending', 'withdrawn'] },
    });
    return { id: approvalId };
  });
}

/** Ticks or unticks one checklist item of a stage on an opportunity. */
export async function setChecklistItem(
  ctx: TenantContext,
  input: ChecklistInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'opportunities.edit');
  return withRls(ctx, async (tx) => {
    const existing = await loadForWrite(tx, ctx, input.id);
    assertCanAccess(ctx, 'opportunities.edit', existing);
    const pipeline = await loadPipelineConfig(tx, ctx, existing.pipelineId);
    const stage = pipeline.stages.find((candidate) => candidate.id === input.stageId);
    if (!stage || !stage.checklist.some((item) => item.id === input.itemId)) {
      throw new AppError('NOT_FOUND', 'That checklist item was not found.');
    }
    const state = { ...((existing.checklistState ?? {}) as Record<string, string[]>) };
    const done = new Set(state[stage.id] ?? []);
    if (input.done) done.add(input.itemId);
    else done.delete(input.itemId);
    state[stage.id] = [...done];
    await tx
      .update(opportunities)
      .set({ checklistState: state, updatedBy: ctx.userId })
      .where(and(eq(opportunities.tenantId, ctx.tenantId), eq(opportunities.id, existing.id)));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'opportunity',
      entityId: existing.id,
      context: { checklist: { stageId: stage.id, itemId: input.itemId, done: input.done } },
    });
    return { id: existing.id };
  });
}

/** Adds another person (from the same workspace) to an opportunity with a role. */
export async function addOpportunityContact(
  ctx: TenantContext,
  input: OpportunityContactInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'opportunities.edit');
  return withRls(ctx, async (tx) => {
    const existing = await loadForWrite(tx, ctx, input.id);
    assertCanAccess(ctx, 'opportunities.edit', existing);
    if (input.contactId === existing.contactId) {
      throw new AppError('CONFLICT', 'That person is already the main contact.');
    }
    await assertContactVisible(tx, ctx, input.contactId);
    const [link] = await tx
      .insert(opportunityContacts)
      .values({
        tenantId: ctx.tenantId,
        opportunityId: existing.id,
        contactId: input.contactId,
        role: input.role,
        createdBy: ctx.userId,
      })
      .onConflictDoNothing()
      .returning({ id: opportunityContacts.id });
    if (!link) throw new AppError('CONFLICT', 'That person is already on this opportunity.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'opportunity',
      entityId: existing.id,
      context: { addedContactId: input.contactId, role: input.role },
    });
    return link;
  });
}

export async function removeOpportunityContact(
  ctx: TenantContext,
  input: { id: string; linkId: string },
): Promise<{ id: string }> {
  requirePermission(ctx, 'opportunities.edit');
  return withRls(ctx, async (tx) => {
    const existing = await loadForWrite(tx, ctx, input.id);
    assertCanAccess(ctx, 'opportunities.edit', existing);
    const [removed] = await tx
      .delete(opportunityContacts)
      .where(
        and(
          eq(opportunityContacts.tenantId, ctx.tenantId),
          eq(opportunityContacts.opportunityId, existing.id),
          eq(opportunityContacts.id, input.linkId),
        ),
      )
      .returning({ contactId: opportunityContacts.contactId });
    if (!removed) throw new AppError('NOT_FOUND', 'That person was not found on it.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'opportunity',
      entityId: existing.id,
      context: { removedContactId: removed.contactId },
    });
    return { id: input.linkId };
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
    await tx
      .update(stageApprovals)
      .set({ status: 'withdrawn', decidedBy: ctx.userId, decidedAt: new Date() })
      .where(
        and(
          eq(stageApprovals.tenantId, ctx.tenantId),
          eq(stageApprovals.opportunityId, id),
          inArray(stageApprovals.status, ['pending']),
        ),
      );
    await audit(tx, ctx, { action: 'delete', entityType: 'opportunity', entityId: id });
    return { id };
  });
}

/** Keeps opportunities.next_task_due_at equal to its earliest open task (database.md §10). */
export async function refreshNextTaskDue(
  tx: Tx,
  ctx: Pick<TenantContext, 'tenantId'>,
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
