import 'server-only';

import { and, asc, eq, isNull, or } from 'drizzle-orm';

import { lostReasons, pipelineStages, pipelines } from '@/db/schema';
import { AppError } from '@/lib/errors';
import type { TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

export type StageCategory = 'open' | 'won' | 'lost';

export type ChecklistItem = { id: string; label: string };

export type Stage = {
  id: string;
  name: string;
  position: number;
  category: StageCategory;
  probability: number | null;
  color: string | null;
  staleAfterDays: number | null;
  isActive: boolean;
  ownerUserId: string | null;
  ownerTeamId: string | null;
  onEnter: 'notify' | 'reassign' | 'task';
  requiredFields: string[];
  checklist: ChecklistItem[];
  requiresApproval: boolean;
};

export type PipelineSummary = {
  id: string;
  name: string;
  leadType: 'b2b' | 'b2c' | null;
  isDefault: boolean;
  isActive: boolean;
};

export type PipelineConfig = PipelineSummary & {
  stages: Stage[];
  lostReasons: { id: string; name: string }[];
};

function parseChecklist(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) =>
    typeof item === 'object' &&
    item !== null &&
    typeof (item as ChecklistItem).id === 'string' &&
    typeof (item as ChecklistItem).label === 'string'
      ? [{ id: (item as ChecklistItem).id, label: (item as ChecklistItem).label }]
      : [],
  );
}

const ON_ENTER = ['notify', 'reassign', 'task'] as const;

export async function listPipelineSummaries(tx: Tx, tenantId: string): Promise<PipelineSummary[]> {
  return tx
    .select({
      id: pipelines.id,
      name: pipelines.name,
      leadType: pipelines.leadType,
      isDefault: pipelines.isDefault,
      isActive: pipelines.isActive,
    })
    .from(pipelines)
    .where(and(eq(pipelines.tenantId, tenantId), eq(pipelines.objectType, 'opportunity')))
    .orderBy(asc(pipelines.position), asc(pipelines.createdAt));
}

export async function getPipelineSummaries(ctx: TenantContext): Promise<PipelineSummary[]> {
  return withRls(ctx, (tx) => listPipelineSummaries(tx, ctx.tenantId));
}

/**
 * One pipeline with its stages (active and inactive) and the lost reasons: the named one, or the
 * workspace's default when none is named.
 */
export async function loadPipelineConfig(
  tx: Tx,
  ctx: Pick<TenantContext, 'tenantId'>,
  pipelineId?: string | null,
): Promise<PipelineConfig> {
  const [pipeline] = await tx
    .select({
      id: pipelines.id,
      name: pipelines.name,
      leadType: pipelines.leadType,
      isDefault: pipelines.isDefault,
      isActive: pipelines.isActive,
    })
    .from(pipelines)
    .where(
      and(
        eq(pipelines.tenantId, ctx.tenantId),
        eq(pipelines.objectType, 'opportunity'),
        pipelineId ? eq(pipelines.id, pipelineId) : eq(pipelines.isDefault, true),
      ),
    )
    .limit(1);
  if (!pipeline) {
    throw new AppError(
      'NOT_FOUND',
      pipelineId ? 'That pipeline was not found.' : 'This workspace has no pipeline yet.',
    );
  }

  const [stages, reasons] = await Promise.all([
    tx
      .select()
      .from(pipelineStages)
      .where(
        and(eq(pipelineStages.tenantId, ctx.tenantId), eq(pipelineStages.pipelineId, pipeline.id)),
      )
      .orderBy(asc(pipelineStages.position)),
    tx
      .select({ id: lostReasons.id, name: lostReasons.name })
      .from(lostReasons)
      .where(and(eq(lostReasons.tenantId, ctx.tenantId), eq(lostReasons.isActive, true)))
      .orderBy(asc(lostReasons.position), asc(lostReasons.name)),
  ]);

  return {
    ...pipeline,
    stages: stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      position: stage.position,
      category: stage.category,
      probability: stage.probability,
      color: stage.color,
      staleAfterDays: stage.staleAfterDays,
      isActive: stage.isActive,
      ownerUserId: stage.ownerUserId,
      ownerTeamId: stage.ownerTeamId,
      onEnter: (ON_ENTER as readonly string[]).includes(stage.onEnter)
        ? (stage.onEnter as Stage['onEnter'])
        : 'notify',
      requiredFields: stage.requiredFields,
      checklist: parseChecklist(stage.checklist),
      requiresApproval: stage.requiresApproval,
    })),
    lostReasons: reasons,
  };
}

/** A pipeline with its stages: the named one, or the default. */
export async function getPipelineConfig(
  ctx: TenantContext,
  pipelineId?: string | null,
): Promise<PipelineConfig> {
  return withRls(ctx, (tx) => loadPipelineConfig(tx, ctx, pipelineId));
}

/** Where converted leads of a type start: the first active pipeline set for that type, else the default. */
export async function pipelineIdForLeadType(
  tx: Tx,
  tenantId: string,
  leadType: 'b2b' | 'b2c' | null,
): Promise<string | null> {
  if (!leadType) return null;
  const [match] = await tx
    .select({ id: pipelines.id })
    .from(pipelines)
    .where(
      and(
        eq(pipelines.tenantId, tenantId),
        eq(pipelines.objectType, 'opportunity'),
        eq(pipelines.isActive, true),
        or(eq(pipelines.leadType, leadType), isNull(pipelines.leadType)),
      ),
    )
    .orderBy(asc(pipelines.leadType), asc(pipelines.position))
    .limit(1);
  // `order by lead_type` puts the type's own pipeline before the shared ones (nulls last).
  return match?.id ?? null;
}

export { stageColorVar } from '@/lib/stage-color';
