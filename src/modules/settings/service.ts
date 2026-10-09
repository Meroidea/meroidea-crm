import 'server-only';

import { and, count, eq, isNull, max } from 'drizzle-orm';

import {
  leadSources,
  lostReasons,
  opportunities,
  pipelineStages,
  roles,
  tenantMemberships,
} from '@/db/schema';
import { diffChanges } from '@/lib/audit-diff';
import { AppError } from '@/lib/errors';
import { loadPipelineConfig } from '@/modules/pipelines/queries';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

type Result = { id: string };

export async function updateStage(
  ctx: TenantContext,
  input: {
    id: string;
    name: string;
    probability: number;
    staleAfterDays: number | null;
    color?: string | undefined;
  },
): Promise<Result> {
  requirePermission(ctx, 'settings.manage');
  return withRls(ctx, async (tx) => {
    const [stage] = await tx
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.tenantId, ctx.tenantId), eq(pipelineStages.id, input.id)))
      .limit(1);
    if (!stage) throw new AppError('NOT_FOUND', 'That stage was not found.');
    const next = {
      name: input.name,
      probability: input.probability,
      staleAfterDays: stage.category === 'open' ? input.staleAfterDays : null,
      color: input.color ?? stage.color,
    };
    const changes = diffChanges(stage, next);
    if (Object.keys(changes).length === 0) return { id: stage.id };
    await tx.update(pipelineStages).set(next).where(eq(pipelineStages.id, stage.id));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'pipeline_stage',
      entityId: stage.id,
      changes,
    });
    return { id: stage.id };
  });
}

/** New stages are open stages, placed just before the first won/lost stage. */
export async function addStage(ctx: TenantContext, name: string): Promise<Result> {
  requirePermission(ctx, 'settings.manage');
  return withRls(ctx, async (tx) => {
    const pipeline = await loadPipelineConfig(tx, ctx);
    const firstClosed = pipeline.stages.find((stage) => stage.category !== 'open');
    const position = firstClosed ? firstClosed.position : pipeline.stages.length;
    for (const stage of [...pipeline.stages].reverse()) {
      if (stage.position >= position) {
        await tx
          .update(pipelineStages)
          .set({ position: stage.position + 1 })
          .where(eq(pipelineStages.id, stage.id));
      }
    }
    const [created] = await tx
      .insert(pipelineStages)
      .values({
        tenantId: ctx.tenantId,
        pipelineId: pipeline.id,
        name,
        position,
        category: 'open',
        probability: 50,
        color: 'chart-3',
        staleAfterDays: 7,
      })
      .returning({ id: pipelineStages.id });
    if (!created) throw new AppError('INTERNAL', 'Could not add the stage.');
    await audit(tx, ctx, { action: 'create', entityType: 'pipeline_stage', entityId: created.id });
    return created;
  });
}

/** Open stages reorder among themselves; won and lost always stay at the end. */
export async function moveStagePosition(
  ctx: TenantContext,
  input: { id: string; direction: 'up' | 'down' },
): Promise<Result> {
  requirePermission(ctx, 'settings.manage');
  return withRls(ctx, async (tx) => {
    const pipeline = await loadPipelineConfig(tx, ctx);
    const open = pipeline.stages.filter((stage) => stage.category === 'open');
    const index = open.findIndex((stage) => stage.id === input.id);
    if (index < 0) throw new AppError('VALIDATION', 'Only open stages can be reordered.');
    const swap = open[input.direction === 'up' ? index - 1 : index + 1];
    const current = open[index];
    if (!swap || !current) return { id: input.id };
    await tx
      .update(pipelineStages)
      .set({ position: swap.position })
      .where(eq(pipelineStages.id, current.id));
    await tx
      .update(pipelineStages)
      .set({ position: current.position })
      .where(eq(pipelineStages.id, swap.id));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'pipeline_stage',
      entityId: current.id,
      changes: { position: [current.position, swap.position] },
    });
    return { id: input.id };
  });
}

/**
 * A stage holding open opportunities can't be switched off — move them first
 * (docs/database.md §4). A pipeline always keeps an active open, won and lost stage.
 */
export async function toggleStage(
  ctx: TenantContext,
  input: { id: string; isActive: boolean },
): Promise<Result> {
  requirePermission(ctx, 'settings.manage');
  return withRls(ctx, async (tx) => {
    const pipeline = await loadPipelineConfig(tx, ctx);
    const stage = pipeline.stages.find((candidate) => candidate.id === input.id);
    if (!stage) throw new AppError('NOT_FOUND', 'That stage was not found.');
    if (!input.isActive) {
      const remaining = pipeline.stages.filter(
        (candidate) =>
          candidate.isActive && candidate.id !== stage.id && candidate.category === stage.category,
      );
      if (remaining.length === 0) {
        throw new AppError(
          'CONFLICT',
          `The pipeline needs at least one active ${stage.category} stage.`,
        );
      }
      const [held] = await tx
        .select({ total: count() })
        .from(opportunities)
        .where(
          and(
            eq(opportunities.tenantId, ctx.tenantId),
            eq(opportunities.stageId, stage.id),
            eq(opportunities.status, 'open'),
            isNull(opportunities.deletedAt),
          ),
        );
      if ((held?.total ?? 0) > 0) {
        throw new AppError(
          'CONFLICT',
          `Move the ${held?.total} open opportunities out of ${stage.name} first.`,
        );
      }
    }
    await tx
      .update(pipelineStages)
      .set({ isActive: input.isActive })
      .where(eq(pipelineStages.id, stage.id));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'pipeline_stage',
      entityId: stage.id,
      changes: { isActive: [stage.isActive, input.isActive] },
    });
    return { id: stage.id };
  });
}

export async function addLeadSource(ctx: TenantContext, name: string): Promise<Result> {
  requirePermission(ctx, 'settings.manage');
  return withRls(ctx, async (tx) => {
    const [last] = await tx
      .select({ position: max(leadSources.position) })
      .from(leadSources)
      .where(eq(leadSources.tenantId, ctx.tenantId));
    const [created] = await tx
      .insert(leadSources)
      .values({ tenantId: ctx.tenantId, name, type: 'other', position: (last?.position ?? 0) + 1 })
      .onConflictDoNothing()
      .returning({ id: leadSources.id });
    if (!created) throw new AppError('CONFLICT', 'That source already exists.');
    await audit(tx, ctx, { action: 'create', entityType: 'lead_source', entityId: created.id });
    return created;
  });
}

export async function toggleLeadSource(
  ctx: TenantContext,
  input: { id: string; isActive: boolean },
): Promise<Result> {
  requirePermission(ctx, 'settings.manage');
  return withRls(ctx, async (tx) => {
    const [updated] = await tx
      .update(leadSources)
      .set({ isActive: input.isActive })
      .where(and(eq(leadSources.tenantId, ctx.tenantId), eq(leadSources.id, input.id)))
      .returning({ id: leadSources.id });
    if (!updated) throw new AppError('NOT_FOUND', 'That source was not found.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'lead_source',
      entityId: input.id,
      changes: { isActive: [!input.isActive, input.isActive] },
    });
    return updated;
  });
}

export async function addLostReason(ctx: TenantContext, name: string): Promise<Result> {
  requirePermission(ctx, 'settings.manage');
  return withRls(ctx, async (tx) => {
    const [last] = await tx
      .select({ position: max(lostReasons.position) })
      .from(lostReasons)
      .where(eq(lostReasons.tenantId, ctx.tenantId));
    const [created] = await tx
      .insert(lostReasons)
      .values({ tenantId: ctx.tenantId, name, position: (last?.position ?? 0) + 1 })
      .onConflictDoNothing()
      .returning({ id: lostReasons.id });
    if (!created) throw new AppError('CONFLICT', 'That reason already exists.');
    await audit(tx, ctx, { action: 'create', entityType: 'lost_reason', entityId: created.id });
    return created;
  });
}

export async function toggleLostReason(
  ctx: TenantContext,
  input: { id: string; isActive: boolean },
): Promise<Result> {
  requirePermission(ctx, 'settings.manage');
  return withRls(ctx, async (tx) => {
    const [updated] = await tx
      .update(lostReasons)
      .set({ isActive: input.isActive })
      .where(and(eq(lostReasons.tenantId, ctx.tenantId), eq(lostReasons.id, input.id)))
      .returning({ id: lostReasons.id });
    if (!updated) throw new AppError('NOT_FOUND', 'That reason was not found.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'lost_reason',
      entityId: input.id,
      changes: { isActive: [!input.isActive, input.isActive] },
    });
    return updated;
  });
}

/** Changing someone's role. The workspace must always keep at least one active owner. */
export async function changeMemberRole(
  ctx: TenantContext,
  input: { userId: string; roleId: string },
): Promise<Result> {
  requirePermission(ctx, 'users.manage');
  return withRls(ctx, async (tx) => {
    const [membership] = await tx
      .select({ id: tenantMemberships.id, roleId: tenantMemberships.roleId })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, ctx.tenantId),
          eq(tenantMemberships.userId, input.userId),
        ),
      )
      .limit(1)
      .for('update');
    if (!membership) throw new AppError('NOT_FOUND', 'That person was not found.');
    const roleRows = await tx
      .select({ id: roles.id, key: roles.key })
      .from(roles)
      .where(eq(roles.tenantId, ctx.tenantId));
    const target = roleRows.find((role) => role.id === input.roleId);
    const ownerRole = roleRows.find((role) => role.key === 'owner');
    if (!target) throw new AppError('VALIDATION', 'Choose a role.');
    if (membership.roleId === target.id) return { id: membership.id };

    if (ownerRole && membership.roleId === ownerRole.id) {
      const [owners] = await tx
        .select({ total: count() })
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.tenantId, ctx.tenantId),
            eq(tenantMemberships.roleId, ownerRole.id),
            eq(tenantMemberships.status, 'active'),
          ),
        );
      if ((owners?.total ?? 0) <= 1) {
        throw new AppError(
          'CONFLICT',
          'The workspace needs at least one owner. Make someone else owner first.',
        );
      }
    }

    await tx
      .update(tenantMemberships)
      .set({ roleId: target.id })
      .where(eq(tenantMemberships.id, membership.id));
    await audit(tx, ctx, {
      action: 'permission_change',
      entityType: 'membership',
      entityId: membership.id,
      changes: { roleId: [membership.roleId, target.id] },
    });
    return { id: membership.id };
  });
}
