import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { lostReasons, pipelineStages, pipelines } from '@/db/schema';
import { AppError } from '@/lib/errors';
import type { TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

export type StageCategory = 'open' | 'won' | 'lost';

export type Stage = {
  id: string;
  name: string;
  position: number;
  category: StageCategory;
  probability: number | null;
  color: string | null;
  staleAfterDays: number | null;
  isActive: boolean;
};

export type PipelineConfig = {
  id: string;
  name: string;
  stages: Stage[];
  lostReasons: { id: string; name: string }[];
};

export async function loadPipelineConfig(tx: Tx, ctx: TenantContext): Promise<PipelineConfig> {
  const [pipeline] = await tx
    .select({ id: pipelines.id, name: pipelines.name })
    .from(pipelines)
    .where(
      and(
        eq(pipelines.tenantId, ctx.tenantId),
        eq(pipelines.objectType, 'opportunity'),
        eq(pipelines.isDefault, true),
      ),
    )
    .limit(1);
  if (!pipeline) throw new AppError('NOT_FOUND', 'This workspace has no pipeline yet.');

  const [stages, reasons] = await Promise.all([
    tx
      .select({
        id: pipelineStages.id,
        name: pipelineStages.name,
        position: pipelineStages.position,
        category: pipelineStages.category,
        probability: pipelineStages.probability,
        color: pipelineStages.color,
        staleAfterDays: pipelineStages.staleAfterDays,
        isActive: pipelineStages.isActive,
      })
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

  return { ...pipeline, stages, lostReasons: reasons };
}

/** The workspace's default sales pipeline with its stages (active and inactive) and lost reasons. */
export async function getPipelineConfig(ctx: TenantContext): Promise<PipelineConfig> {
  return withRls(ctx, (tx) => loadPipelineConfig(tx, ctx));
}

export { stageColorVar } from '@/lib/stage-color';
