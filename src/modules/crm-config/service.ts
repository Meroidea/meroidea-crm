import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, asc, count, eq, inArray, isNull, max, ne, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import {
  customFieldDefinitions,
  emailTemplates,
  leadReasons,
  leadSources,
  leadStatuses,
  leadSubSources,
  opportunities,
  pipelineStages,
  pipelines,
  rolePermissions,
  roles,
  routingRules,
  sequences,
  teams,
  tenantMemberships,
  webForms,
} from '@/db/schema';
import { diffChanges } from '@/lib/audit-diff';
import { AppError } from '@/lib/errors';
import { isScoped, PERMISSION_KEYS, type PermissionKey } from '@/lib/permissions/catalog';
import { DEFAULT_PIPELINE } from '@/lib/tenant/defaults';
import { keyFromLabel } from '@/modules/custom-fields/validation';
import { formFieldsSchema, type FormField } from '@/modules/leads/form-fields';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import type {
  CustomFieldInput,
  RoleInput,
  RoutingRuleInput,
  SequenceInput,
  StageRulesInput,
  WebFormInput,
} from './schemas';

type Result = { id: string };

/** Every change here configures the business: settings.manage, inside its own tenant. */
function configure<T>(ctx: TenantContext, work: (tx: Tx) => Promise<T>): Promise<T> {
  requirePermission(ctx, 'settings.manage');
  return withRls(ctx, work);
}

async function nextPosition(tx: Tx, column: AnyPgColumn, where: SQL | undefined) {
  const [row] = await tx
    .select({ value: max(column) })
    .from(column.table)
    .where(where);
  return row?.value === null || row?.value === undefined ? 0 : Number(row.value) + 1;
}

async function assertMembers(tx: Tx, ctx: TenantContext, userIds: string[]) {
  if (userIds.length === 0) return;
  const rows = await tx
    .select({ userId: tenantMemberships.userId })
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.tenantId, ctx.tenantId),
        inArray(tenantMemberships.userId, userIds),
        eq(tenantMemberships.status, 'active'),
      ),
    );
  if (rows.length !== new Set(userIds).size) {
    throw new AppError('VALIDATION', 'Choose active members of your team.', {
      userIds: ['Not available'],
    });
  }
}

async function assertTeam(tx: Tx, ctx: TenantContext, teamId: string | null) {
  if (!teamId) return;
  const [team] = await tx
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.tenantId, ctx.tenantId), eq(teams.id, teamId)))
    .limit(1);
  if (!team) throw new AppError('VALIDATION', 'That team was not found.', { teamId: ['Invalid'] });
}

// ── Sources and sub-sources ──────────────────────────────────────────────────

export function renameSource(ctx: TenantContext, input: { id: string; name: string }) {
  return configure(ctx, async (tx) => {
    const [row] = await tx
      .update(leadSources)
      .set({ name: input.name })
      .where(and(eq(leadSources.tenantId, ctx.tenantId), eq(leadSources.id, input.id)))
      .returning({ id: leadSources.id });
    if (!row) throw new AppError('NOT_FOUND', 'That source was not found.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'lead_source',
      entityId: row.id,
      changes: { name: [null, input.name] },
    });
    return row;
  }).catch(rethrowDuplicate('A source with that name already exists.'));
}

export function addSubSource(ctx: TenantContext, input: { sourceId: string; name: string }) {
  return configure(ctx, async (tx) => {
    const [source] = await tx
      .select({ id: leadSources.id })
      .from(leadSources)
      .where(and(eq(leadSources.tenantId, ctx.tenantId), eq(leadSources.id, input.sourceId)))
      .limit(1);
    if (!source) throw new AppError('NOT_FOUND', 'That source was not found.');
    const position = await nextPosition(
      tx,
      leadSubSources.position,
      and(eq(leadSubSources.tenantId, ctx.tenantId), eq(leadSubSources.sourceId, source.id)),
    );
    const [created] = await tx
      .insert(leadSubSources)
      .values({ tenantId: ctx.tenantId, sourceId: source.id, name: input.name, position })
      .onConflictDoNothing()
      .returning({ id: leadSubSources.id });
    if (!created) throw new AppError('CONFLICT', 'That sub-source already exists.');
    await audit(tx, ctx, { action: 'create', entityType: 'lead_sub_source', entityId: created.id });
    return created;
  });
}

export function renameSubSource(ctx: TenantContext, input: { id: string; name: string }) {
  return configure(ctx, async (tx) => {
    const [row] = await tx
      .update(leadSubSources)
      .set({ name: input.name })
      .where(and(eq(leadSubSources.tenantId, ctx.tenantId), eq(leadSubSources.id, input.id)))
      .returning({ id: leadSubSources.id });
    if (!row) throw new AppError('NOT_FOUND', 'That sub-source was not found.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'lead_sub_source',
      entityId: row.id,
      changes: { name: [null, input.name] },
    });
    return row;
  }).catch(rethrowDuplicate('That source already has a sub-source with that name.'));
}

export function toggleSubSource(ctx: TenantContext, input: { id: string; isActive: boolean }) {
  return configure(ctx, async (tx) => {
    const [row] = await tx
      .update(leadSubSources)
      .set({ isActive: input.isActive })
      .where(and(eq(leadSubSources.tenantId, ctx.tenantId), eq(leadSubSources.id, input.id)))
      .returning({ id: leadSubSources.id });
    if (!row) throw new AppError('NOT_FOUND', 'That sub-source was not found.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'lead_sub_source',
      entityId: row.id,
      changes: { isActive: [!input.isActive, input.isActive] },
    });
    return row;
  });
}

function rethrowDuplicate(message: string) {
  return (error: unknown): never => {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    if (code === '23505') throw new AppError('CONFLICT', message);
    throw error;
  };
}

// ── Lead statuses and reasons ────────────────────────────────────────────────

export function saveLeadStatus(
  ctx: TenantContext,
  input: {
    id?: string | undefined;
    name: string;
    kind?: 'working' | 'closed' | undefined;
    leadType: 'b2b' | 'b2c' | null;
    requiresReason: boolean;
    color: string;
  },
): Promise<Result> {
  return configure(ctx, async (tx) => {
    if (input.id) {
      const [existing] = await tx
        .select()
        .from(leadStatuses)
        .where(and(eq(leadStatuses.tenantId, ctx.tenantId), eq(leadStatuses.id, input.id)))
        .limit(1);
      if (!existing) throw new AppError('NOT_FOUND', 'That status was not found.');
      // A system status keeps its kind and workflow: the system moves leads into it.
      const next = {
        name: input.name,
        color: input.color,
        requiresReason: existing.kind === 'closed' ? input.requiresReason : false,
        leadType: existing.isSystem ? existing.leadType : input.leadType,
      };
      const changes = diffChanges(existing, next);
      if (Object.keys(changes).length === 0) return { id: existing.id };
      await tx.update(leadStatuses).set(next).where(eq(leadStatuses.id, existing.id));
      await audit(tx, ctx, {
        action: 'update',
        entityType: 'lead_status',
        entityId: existing.id,
        changes,
      });
      return { id: existing.id };
    }
    if (!input.kind) throw new AppError('VALIDATION', 'Choose what kind of status it is.');
    const position = await nextPosition(
      tx,
      leadStatuses.position,
      eq(leadStatuses.tenantId, ctx.tenantId),
    );
    const [created] = await tx
      .insert(leadStatuses)
      .values({
        tenantId: ctx.tenantId,
        name: input.name,
        kind: input.kind,
        leadType: input.leadType,
        requiresReason: input.kind === 'closed' ? input.requiresReason : false,
        color: input.color,
        position,
      })
      .returning({ id: leadStatuses.id });
    if (!created) throw new AppError('INTERNAL', 'Could not add the status.');
    await audit(tx, ctx, { action: 'create', entityType: 'lead_status', entityId: created.id });
    return created;
  });
}

export function toggleLeadStatus(ctx: TenantContext, input: { id: string; isActive: boolean }) {
  return configure(ctx, async (tx) => {
    const [status] = await tx
      .select()
      .from(leadStatuses)
      .where(and(eq(leadStatuses.tenantId, ctx.tenantId), eq(leadStatuses.id, input.id)))
      .limit(1);
    if (!status) throw new AppError('NOT_FOUND', 'That status was not found.');
    if (status.isSystem && !input.isActive) {
      throw new AppError(
        'CONFLICT',
        `${status.name} is used by the workflow and can be renamed, not switched off.`,
      );
    }
    await tx
      .update(leadStatuses)
      .set({ isActive: input.isActive })
      .where(eq(leadStatuses.id, status.id));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'lead_status',
      entityId: status.id,
      changes: { isActive: [status.isActive, input.isActive] },
    });
    return { id: status.id };
  });
}

export function moveLeadStatus(
  ctx: TenantContext,
  input: { id: string; direction: 'up' | 'down' },
) {
  return configure(ctx, async (tx) => {
    const rows = await tx
      .select({ id: leadStatuses.id, position: leadStatuses.position })
      .from(leadStatuses)
      .where(eq(leadStatuses.tenantId, ctx.tenantId))
      .orderBy(asc(leadStatuses.position), asc(leadStatuses.name));
    const index = rows.findIndex((row) => row.id === input.id);
    const other = rows[input.direction === 'up' ? index - 1 : index + 1];
    const current = rows[index];
    if (!current || !other) return { id: input.id };
    // Positions may tie after imports; renumber, then swap.
    for (const [i, row] of rows.entries()) {
      await tx.update(leadStatuses).set({ position: i }).where(eq(leadStatuses.id, row.id));
    }
    const a = rows.indexOf(current);
    const b = rows.indexOf(other);
    await tx.update(leadStatuses).set({ position: b }).where(eq(leadStatuses.id, current.id));
    await tx.update(leadStatuses).set({ position: a }).where(eq(leadStatuses.id, other.id));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'lead_status',
      entityId: current.id,
      context: { moved: input.direction },
    });
    return { id: input.id };
  });
}

export function addLeadReason(
  ctx: TenantContext,
  input: { kind: 'disqualify' | 'reject'; name: string },
) {
  return configure(ctx, async (tx) => {
    const position = await nextPosition(
      tx,
      leadReasons.position,
      and(eq(leadReasons.tenantId, ctx.tenantId), eq(leadReasons.kind, input.kind)),
    );
    const [created] = await tx
      .insert(leadReasons)
      .values({ tenantId: ctx.tenantId, kind: input.kind, name: input.name, position })
      .onConflictDoNothing()
      .returning({ id: leadReasons.id });
    if (!created) throw new AppError('CONFLICT', 'That reason already exists.');
    await audit(tx, ctx, { action: 'create', entityType: 'lead_reason', entityId: created.id });
    return created;
  });
}

export function toggleLeadReason(ctx: TenantContext, input: { id: string; isActive: boolean }) {
  return configure(ctx, async (tx) => {
    const [row] = await tx
      .update(leadReasons)
      .set({ isActive: input.isActive })
      .where(and(eq(leadReasons.tenantId, ctx.tenantId), eq(leadReasons.id, input.id)))
      .returning({ id: leadReasons.id });
    if (!row) throw new AppError('NOT_FOUND', 'That reason was not found.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'lead_reason',
      entityId: row.id,
      changes: { isActive: [!input.isActive, input.isActive] },
    });
    return row;
  });
}

// ── Routing rules ────────────────────────────────────────────────────────────

export function saveRoutingRule(ctx: TenantContext, input: RoutingRuleInput): Promise<Result> {
  return configure(ctx, async (tx) => {
    await assertMembers(tx, ctx, input.userIds);
    await assertTeam(tx, ctx, input.teamId);
    const values = {
      name: input.name,
      stage: input.stage,
      leadType: input.leadType,
      method: input.method,
      userIds: [...new Set(input.userIds)],
      teamId: input.teamId,
      conditions: input.conditions,
      isActive: input.isActive,
      updatedAt: new Date(),
    };
    if (input.id) {
      const [row] = await tx
        .update(routingRules)
        .set(values)
        .where(and(eq(routingRules.tenantId, ctx.tenantId), eq(routingRules.id, input.id)))
        .returning({ id: routingRules.id });
      if (!row) throw new AppError('NOT_FOUND', 'That rule was not found.');
      await audit(tx, ctx, {
        action: 'update',
        entityType: 'routing_rule',
        entityId: row.id,
        context: { name: input.name },
      });
      return row;
    }
    const position = await nextPosition(
      tx,
      routingRules.position,
      eq(routingRules.tenantId, ctx.tenantId),
    );
    const [created] = await tx
      .insert(routingRules)
      .values({ tenantId: ctx.tenantId, ...values, position })
      .returning({ id: routingRules.id });
    if (!created) throw new AppError('INTERNAL', 'Could not save the rule.');
    await audit(tx, ctx, { action: 'create', entityType: 'routing_rule', entityId: created.id });
    return created;
  });
}

export function deleteRoutingRule(ctx: TenantContext, id: string): Promise<Result> {
  return configure(ctx, async (tx) => {
    const [row] = await tx
      .delete(routingRules)
      .where(and(eq(routingRules.tenantId, ctx.tenantId), eq(routingRules.id, id)))
      .returning({ id: routingRules.id });
    if (!row) throw new AppError('NOT_FOUND', 'That rule was not found.');
    await audit(tx, ctx, { action: 'delete', entityType: 'routing_rule', entityId: id });
    return row;
  });
}

export function moveRoutingRule(
  ctx: TenantContext,
  input: { id: string; direction: 'up' | 'down' },
) {
  return configure(ctx, async (tx) => {
    const rows = await tx
      .select({ id: routingRules.id })
      .from(routingRules)
      .where(eq(routingRules.tenantId, ctx.tenantId))
      .orderBy(asc(routingRules.position), asc(routingRules.createdAt));
    const index = rows.findIndex((row) => row.id === input.id);
    const swapWith = input.direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || swapWith < 0 || swapWith >= rows.length) return { id: input.id };
    const order = rows.map((row) => row.id);
    [order[index], order[swapWith]] = [order[swapWith]!, order[index]!];
    for (const [position, id] of order.entries()) {
      await tx.update(routingRules).set({ position }).where(eq(routingRules.id, id));
    }
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'routing_rule',
      entityId: input.id,
      context: { moved: input.direction },
    });
    return { id: input.id };
  });
}

// ── Pipelines and stage rules ────────────────────────────────────────────────

export function savePipeline(
  ctx: TenantContext,
  input: {
    id?: string | undefined;
    name: string;
    leadType: 'b2b' | 'b2c' | null;
    description: string | null;
  },
): Promise<Result> {
  return configure(ctx, async (tx) => {
    if (input.id) {
      const [row] = await tx
        .update(pipelines)
        .set({ name: input.name, leadType: input.leadType, description: input.description })
        .where(and(eq(pipelines.tenantId, ctx.tenantId), eq(pipelines.id, input.id)))
        .returning({ id: pipelines.id });
      if (!row) throw new AppError('NOT_FOUND', 'That pipeline was not found.');
      await audit(tx, ctx, {
        action: 'update',
        entityType: 'pipeline',
        entityId: row.id,
        context: { name: input.name },
      });
      return row;
    }
    const position = await nextPosition(
      tx,
      pipelines.position,
      eq(pipelines.tenantId, ctx.tenantId),
    );
    const [created] = await tx
      .insert(pipelines)
      .values({
        tenantId: ctx.tenantId,
        name: input.name,
        leadType: input.leadType,
        description: input.description,
        position,
      })
      .returning({ id: pipelines.id });
    if (!created) throw new AppError('INTERNAL', 'Could not add the pipeline.');
    // A new pipeline starts with a working set of stages, renamed to fit afterwards.
    await tx.insert(pipelineStages).values(
      DEFAULT_PIPELINE.stages.map((stage, index) => ({
        tenantId: ctx.tenantId,
        pipelineId: created.id,
        position: index,
        ...stage,
      })),
    );
    await audit(tx, ctx, { action: 'create', entityType: 'pipeline', entityId: created.id });
    return created;
  });
}

export function makeDefaultPipeline(ctx: TenantContext, id: string): Promise<Result> {
  return configure(ctx, async (tx) => {
    const [target] = await tx
      .select({ id: pipelines.id, isActive: pipelines.isActive })
      .from(pipelines)
      .where(and(eq(pipelines.tenantId, ctx.tenantId), eq(pipelines.id, id)))
      .limit(1);
    if (!target) throw new AppError('NOT_FOUND', 'That pipeline was not found.');
    if (!target.isActive) throw new AppError('CONFLICT', 'Switch the pipeline on first.');
    await tx
      .update(pipelines)
      .set({ isDefault: false })
      .where(
        and(
          eq(pipelines.tenantId, ctx.tenantId),
          eq(pipelines.objectType, 'opportunity'),
          ne(pipelines.id, id),
        ),
      );
    await tx.update(pipelines).set({ isDefault: true }).where(eq(pipelines.id, id));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'pipeline',
      entityId: id,
      context: { madeDefault: true },
    });
    return { id };
  });
}

export function togglePipeline(
  ctx: TenantContext,
  input: { id: string; isActive: boolean },
): Promise<Result> {
  return configure(ctx, async (tx) => {
    const [pipeline] = await tx
      .select()
      .from(pipelines)
      .where(and(eq(pipelines.tenantId, ctx.tenantId), eq(pipelines.id, input.id)))
      .limit(1);
    if (!pipeline) throw new AppError('NOT_FOUND', 'That pipeline was not found.');
    if (!input.isActive) {
      if (pipeline.isDefault)
        throw new AppError('CONFLICT', 'Make another pipeline the default first.');
      const [open] = await tx
        .select({ total: count() })
        .from(opportunities)
        .where(
          and(
            eq(opportunities.tenantId, ctx.tenantId),
            eq(opportunities.pipelineId, pipeline.id),
            eq(opportunities.status, 'open'),
            isNull(opportunities.deletedAt),
          ),
        );
      if ((open?.total ?? 0) > 0) {
        throw new AppError(
          'CONFLICT',
          `Close or move its ${open?.total} open opportunities first.`,
        );
      }
    }
    await tx
      .update(pipelines)
      .set({ isActive: input.isActive })
      .where(eq(pipelines.id, pipeline.id));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'pipeline',
      entityId: pipeline.id,
      changes: { isActive: [pipeline.isActive, input.isActive] },
    });
    return { id: pipeline.id };
  });
}

export function saveStageRules(ctx: TenantContext, input: StageRulesInput): Promise<Result> {
  return configure(ctx, async (tx) => {
    const [stage] = await tx
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.tenantId, ctx.tenantId), eq(pipelineStages.id, input.id)))
      .limit(1);
    if (!stage) throw new AppError('NOT_FOUND', 'That stage was not found.');
    if (input.ownerUserId) await assertMembers(tx, ctx, [input.ownerUserId]);
    await assertTeam(tx, ctx, input.ownerTeamId);
    const next = {
      ownerUserId: input.ownerUserId,
      ownerTeamId: input.ownerTeamId,
      onEnter: input.onEnter,
      requiredFields: [...new Set(input.requiredFields)],
      checklist: input.checklist,
      // A lost stage needs only its reason; approvals guard moving forward.
      requiresApproval: stage.category === 'lost' ? false : input.requiresApproval,
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

// ── Custom fields ────────────────────────────────────────────────────────────

export function saveCustomField(
  ctx: TenantContext,
  input: CustomFieldInput,
): Promise<{ id: string; key: string }> {
  return configure(ctx, async (tx) => {
    const choices =
      input.fieldType === 'select' || input.fieldType === 'multi_select'
        ? input.choices.map((label) => ({ value: keyFromLabel(label), label }))
        : [];
    if (
      (input.fieldType === 'select' || input.fieldType === 'multi_select') &&
      choices.length === 0
    ) {
      throw new AppError('VALIDATION', 'Add the options to pick from.', { choices: ['Required'] });
    }
    if (new Set(choices.map((choice) => choice.value)).size !== choices.length) {
      throw new AppError('VALIDATION', 'Two options are too alike; make each one distinct.');
    }
    if (input.id) {
      const [existing] = await tx
        .select()
        .from(customFieldDefinitions)
        .where(
          and(
            eq(customFieldDefinitions.tenantId, ctx.tenantId),
            eq(customFieldDefinitions.id, input.id),
          ),
        )
        .limit(1);
      if (!existing) throw new AppError('NOT_FOUND', 'That field was not found.');
      // The key and type are fixed once created: stored values depend on them.
      const next = {
        label: input.label,
        description: input.description,
        options: choices.length > 0 ? { choices } : existing.options,
        isRequired: input.isRequired,
        showInList: input.showInList,
        updatedAt: new Date(),
      };
      await tx
        .update(customFieldDefinitions)
        .set(next)
        .where(eq(customFieldDefinitions.id, existing.id));
      await audit(tx, ctx, {
        action: 'update',
        entityType: 'custom_field',
        entityId: existing.id,
        context: { label: input.label },
      });
      return { id: existing.id, key: existing.key };
    }
    const base = keyFromLabel(input.label);
    const taken = await tx
      .select({ key: customFieldDefinitions.key })
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.tenantId, ctx.tenantId),
          eq(customFieldDefinitions.entityType, input.entityType),
        ),
      );
    let key = base;
    for (let i = 2; taken.some((row) => row.key === key); i += 1) key = `${base.slice(0, 36)}_${i}`;
    const position = await nextPosition(
      tx,
      customFieldDefinitions.position,
      and(
        eq(customFieldDefinitions.tenantId, ctx.tenantId),
        eq(customFieldDefinitions.entityType, input.entityType),
      ),
    );
    const [created] = await tx
      .insert(customFieldDefinitions)
      .values({
        tenantId: ctx.tenantId,
        entityType: input.entityType,
        key,
        label: input.label,
        description: input.description,
        fieldType: input.fieldType,
        options: choices.length > 0 ? { choices } : {},
        isRequired: input.isRequired,
        showInList: input.showInList,
        position,
      })
      .returning({ id: customFieldDefinitions.id });
    if (!created) throw new AppError('INTERNAL', 'Could not add the field.');
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'custom_field',
      entityId: created.id,
      context: { key },
    });
    return { id: created.id, key };
  });
}

export function toggleCustomField(ctx: TenantContext, input: { id: string; isActive: boolean }) {
  return configure(ctx, async (tx) => {
    const [row] = await tx
      .update(customFieldDefinitions)
      .set({ isActive: input.isActive })
      .where(
        and(
          eq(customFieldDefinitions.tenantId, ctx.tenantId),
          eq(customFieldDefinitions.id, input.id),
        ),
      )
      .returning({ id: customFieldDefinitions.id });
    if (!row) throw new AppError('NOT_FOUND', 'That field was not found.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'custom_field',
      entityId: row.id,
      changes: { isActive: [!input.isActive, input.isActive] },
    });
    return row;
  });
}

// ── Email templates and sequences ────────────────────────────────────────────

export function saveEmailTemplate(
  ctx: TenantContext,
  input: { id?: string | undefined; name: string; subject: string; body: string },
): Promise<Result> {
  return configure(ctx, async (tx) => {
    if (input.id) {
      const [row] = await tx
        .update(emailTemplates)
        .set({ name: input.name, subject: input.subject, body: input.body, updatedAt: new Date() })
        .where(and(eq(emailTemplates.tenantId, ctx.tenantId), eq(emailTemplates.id, input.id)))
        .returning({ id: emailTemplates.id });
      if (!row) throw new AppError('NOT_FOUND', 'That template was not found.');
      await audit(tx, ctx, { action: 'update', entityType: 'email_template', entityId: row.id });
      return row;
    }
    const [created] = await tx
      .insert(emailTemplates)
      .values({
        tenantId: ctx.tenantId,
        name: input.name,
        subject: input.subject,
        body: input.body,
        createdBy: ctx.userId,
      })
      .returning({ id: emailTemplates.id });
    if (!created) throw new AppError('INTERNAL', 'Could not save the template.');
    await audit(tx, ctx, { action: 'create', entityType: 'email_template', entityId: created.id });
    return created;
  }).catch(rethrowDuplicate('A template with that name already exists.'));
}

export function toggleEmailTemplate(ctx: TenantContext, input: { id: string; isActive: boolean }) {
  return configure(ctx, async (tx) => {
    const [row] = await tx
      .update(emailTemplates)
      .set({ isActive: input.isActive })
      .where(and(eq(emailTemplates.tenantId, ctx.tenantId), eq(emailTemplates.id, input.id)))
      .returning({ id: emailTemplates.id });
    if (!row) throw new AppError('NOT_FOUND', 'That template was not found.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'email_template',
      entityId: row.id,
      changes: { isActive: [!input.isActive, input.isActive] },
    });
    return row;
  });
}

export function saveSequence(ctx: TenantContext, input: SequenceInput): Promise<Result> {
  return configure(ctx, async (tx) => {
    const templateIds = input.steps.flatMap((step) => (step.templateId ? [step.templateId] : []));
    if (templateIds.length > 0) {
      const found = await tx
        .select({ id: emailTemplates.id })
        .from(emailTemplates)
        .where(
          and(eq(emailTemplates.tenantId, ctx.tenantId), inArray(emailTemplates.id, templateIds)),
        );
      if (found.length !== new Set(templateIds).size) {
        throw new AppError('VALIDATION', 'A step uses a template that no longer exists.');
      }
    }
    const steps = [...input.steps].sort((a, b) => a.day - b.day);
    if (input.id) {
      const [row] = await tx
        .update(sequences)
        .set({ name: input.name, description: input.description, steps, updatedAt: new Date() })
        .where(and(eq(sequences.tenantId, ctx.tenantId), eq(sequences.id, input.id)))
        .returning({ id: sequences.id });
      if (!row) throw new AppError('NOT_FOUND', 'That sequence was not found.');
      await audit(tx, ctx, { action: 'update', entityType: 'sequence', entityId: row.id });
      return row;
    }
    const [created] = await tx
      .insert(sequences)
      .values({
        tenantId: ctx.tenantId,
        name: input.name,
        description: input.description,
        steps,
        createdBy: ctx.userId,
      })
      .returning({ id: sequences.id });
    if (!created) throw new AppError('INTERNAL', 'Could not save the sequence.');
    await audit(tx, ctx, { action: 'create', entityType: 'sequence', entityId: created.id });
    return created;
  });
}

export function toggleSequence(ctx: TenantContext, input: { id: string; isActive: boolean }) {
  return configure(ctx, async (tx) => {
    const [row] = await tx
      .update(sequences)
      .set({ isActive: input.isActive })
      .where(and(eq(sequences.tenantId, ctx.tenantId), eq(sequences.id, input.id)))
      .returning({ id: sequences.id });
    if (!row) throw new AppError('NOT_FOUND', 'That sequence was not found.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'sequence',
      entityId: row.id,
      changes: { isActive: [!input.isActive, input.isActive] },
    });
    return row;
  });
}

// ── Web forms ────────────────────────────────────────────────────────────────

/** The business's own contact fields a form names must exist and be switched on. */
async function assertFormFields(tx: Tx, ctx: TenantContext, fields: FormField[]) {
  const wanted = fields
    .filter((field) => field.target.startsWith('custom.'))
    .map((field) => field.target.slice('custom.'.length));
  if (wanted.length === 0) return;
  const known = await tx
    .select({ key: customFieldDefinitions.key })
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.tenantId, ctx.tenantId),
        eq(customFieldDefinitions.entityType, 'contact'),
        eq(customFieldDefinitions.isActive, true),
        inArray(customFieldDefinitions.key, wanted),
      ),
    );
  const missing = wanted.filter((key) => !known.some((row) => row.key === key));
  if (missing.length > 0) {
    throw new AppError(
      'VALIDATION',
      'A field on this form was removed or switched off. Take it off the form.',
      {
        fields: ['Unknown field'],
      },
    );
  }
}

/**
 * Saves a website form as the admin built it (docs/leads.md §3.1). A new form is a draft until
 * it is published; saving a published form changes it live.
 */
export function saveWebForm(ctx: TenantContext, input: WebFormInput): Promise<Result> {
  return configure(ctx, async (tx) => {
    const [source] = await tx
      .select({ id: leadSources.id })
      .from(leadSources)
      .where(and(eq(leadSources.tenantId, ctx.tenantId), eq(leadSources.id, input.sourceId)))
      .limit(1);
    if (!source) throw new AppError('VALIDATION', 'Choose a source.', { sourceId: ['Invalid'] });
    if (input.subSourceId) {
      const [sub] = await tx
        .select({ id: leadSubSources.id })
        .from(leadSubSources)
        .where(
          and(
            eq(leadSubSources.tenantId, ctx.tenantId),
            eq(leadSubSources.id, input.subSourceId),
            eq(leadSubSources.sourceId, input.sourceId),
          ),
        )
        .limit(1);
      if (!sub)
        throw new AppError('VALIDATION', 'Choose a sub-source of that source.', {
          subSourceId: ['Invalid'],
        });
    }
    await assertFormFields(tx, ctx, input.fields);
    const targets = new Set(input.fields.map((field) => field.target));
    const values = {
      name: input.name,
      sourceId: input.sourceId,
      subSourceId: input.subSourceId,
      leadType: input.leadType,
      heading: input.heading,
      intro: input.intro,
      submitLabel: input.submitLabel,
      thankYouMessage: input.thankYouMessage,
      fields: input.fields,
      // Kept in step for anything still reading the older switches.
      askCompany: targets.has('companyName') || targets.has('jobTitle'),
      askMessage: targets.has('message'),
      askConsent: targets.has('consent'),
      updatedAt: new Date(),
    };
    if (input.id) {
      const [row] = await tx
        .update(webForms)
        .set(values)
        .where(and(eq(webForms.tenantId, ctx.tenantId), eq(webForms.id, input.id)))
        .returning({ id: webForms.id });
      if (!row) throw new AppError('NOT_FOUND', 'That form was not found.');
      await audit(tx, ctx, {
        action: 'update',
        entityType: 'web_form',
        entityId: row.id,
        context: { fields: input.fields.length },
      });
      return row;
    }
    const [created] = await tx
      .insert(webForms)
      .values({
        tenantId: ctx.tenantId,
        ...values,
        isActive: false,
        publicKey: randomBytes(18).toString('base64url'),
        createdBy: ctx.userId,
      })
      .returning({ id: webForms.id });
    if (!created) throw new AppError('INTERNAL', 'Could not save the form.');
    await audit(tx, ctx, { action: 'create', entityType: 'web_form', entityId: created.id });
    return created;
  });
}

/** Puts a form live, or takes it down; the stored fields are checked again before it goes live. */
export function publishWebForm(ctx: TenantContext, input: { id: string; publish: boolean }) {
  return configure(ctx, async (tx) => {
    const [form] = await tx
      .select({ id: webForms.id, fields: webForms.fields, isActive: webForms.isActive })
      .from(webForms)
      .where(and(eq(webForms.tenantId, ctx.tenantId), eq(webForms.id, input.id)))
      .limit(1)
      .for('update');
    if (!form) throw new AppError('NOT_FOUND', 'That form was not found.');
    if (input.publish) {
      const fields = formFieldsSchema.safeParse(form.fields);
      if (!fields.success) {
        throw new AppError(
          'VALIDATION',
          fields.error.issues[0]?.message ?? 'Finish the form first.',
        );
      }
      await assertFormFields(tx, ctx, fields.data);
    }
    const now = new Date();
    await tx
      .update(webForms)
      .set({
        isActive: input.publish,
        updatedAt: now,
        ...(input.publish ? { publishedAt: now } : {}),
      })
      .where(and(eq(webForms.tenantId, ctx.tenantId), eq(webForms.id, form.id)));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'web_form',
      entityId: form.id,
      changes: { isActive: [form.isActive, input.publish] },
    });
    return { id: form.id };
  });
}

// ── Roles ────────────────────────────────────────────────────────────────────

/**
 * Creates or edits a role and its grants (docs/permissions.md). The Admin role always holds
 * everything and is not editable. Record permissions need a scope; the rest are on or off.
 */
export async function saveRole(ctx: TenantContext, input: RoleInput): Promise<Result> {
  requirePermission(ctx, 'roles.manage');
  type GrantRow = { permission: PermissionKey; scope: 'own' | 'team' | 'all' | null };
  const grants = Object.entries(input.grants).flatMap(([permission, scope]): GrantRow[] => {
    if (!(PERMISSION_KEYS as string[]).includes(permission)) return [];
    const key = permission as PermissionKey;
    if (isScoped(key)) return scope === 'true' ? [] : [{ permission: key, scope }];
    return [{ permission: key, scope: null }];
  });
  // Someone who manages roles but isn't Admin hands out only what they hold themselves, at no
  // wider scope; otherwise roles.manage would let them grant their own role anything.
  if (ctx.roleKey !== 'owner') {
    const rank = { own: 1, team: 2, all: 3 } as const;
    const beyond = grants.find((grant) => {
      const held = ctx.grants.get(grant.permission);
      if (held === undefined) return true;
      if (grant.scope === null || held === true) return false;
      return rank[grant.scope] > rank[held];
    });
    if (beyond) {
      throw new AppError(
        'FORBIDDEN',
        'You can only give a role permissions you have yourself, at the same reach or less.',
      );
    }
  }
  return withRls(ctx, async (tx) => {
    let roleId = input.id;
    if (roleId) {
      const [existing] = await tx
        .select()
        .from(roles)
        .where(and(eq(roles.tenantId, ctx.tenantId), eq(roles.id, roleId)))
        .limit(1);
      if (!existing) throw new AppError('NOT_FOUND', 'That role was not found.');
      if (existing.key === 'owner')
        throw new AppError('FORBIDDEN', 'The Admin role always has every permission.');
      await tx
        .update(roles)
        .set({ name: input.name, description: input.description })
        .where(eq(roles.id, existing.id));
    } else {
      const base = keyFromLabel(input.name).replace(/_/g, '-');
      const taken = await tx
        .select({ key: roles.key })
        .from(roles)
        .where(eq(roles.tenantId, ctx.tenantId));
      let key = base;
      for (
        let i = 2;
        taken.some((row) => row.key === key) || ['owner', 'support'].includes(key);
        i += 1
      ) {
        key = `${base}-${i}`;
      }
      const [created] = await tx
        .insert(roles)
        .values({ tenantId: ctx.tenantId, key, name: input.name, description: input.description })
        .returning({ id: roles.id });
      if (!created) throw new AppError('INTERNAL', 'Could not add the role.');
      roleId = created.id;
    }
    const before = await tx
      .select({ permission: rolePermissions.permission, scope: rolePermissions.scope })
      .from(rolePermissions)
      .where(and(eq(rolePermissions.tenantId, ctx.tenantId), eq(rolePermissions.roleId, roleId)));
    await tx
      .delete(rolePermissions)
      .where(and(eq(rolePermissions.tenantId, ctx.tenantId), eq(rolePermissions.roleId, roleId)));
    if (grants.length > 0) {
      await tx.insert(rolePermissions).values(
        grants.map((grant) => ({
          tenantId: ctx.tenantId,
          roleId: roleId!,
          permission: grant.permission,
          scope: grant.scope,
        })),
      );
    }
    await audit(tx, ctx, {
      action: 'permission_change',
      entityType: 'role',
      entityId: roleId,
      context: {
        name: input.name,
        before: before.map((row) => `${row.permission}${row.scope ? `:${row.scope}` : ''}`).sort(),
        after: grants.map((row) => `${row.permission}${row.scope ? `:${row.scope}` : ''}`).sort(),
      },
    });
    return { id: roleId };
  });
}

export async function deleteRole(ctx: TenantContext, id: string): Promise<Result> {
  requirePermission(ctx, 'roles.manage');
  return withRls(ctx, async (tx) => {
    const [role] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, ctx.tenantId), eq(roles.id, id)))
      .limit(1);
    if (!role) throw new AppError('NOT_FOUND', 'That role was not found.');
    if (role.isSystem || ['owner', 'manager', 'member', 'support'].includes(role.key)) {
      throw new AppError('CONFLICT', 'The built-in roles can be edited but not removed.');
    }
    const [inUse] = await tx
      .select({ total: count() })
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, ctx.tenantId), eq(tenantMemberships.roleId, id)));
    if ((inUse?.total ?? 0) > 0) {
      throw new AppError('CONFLICT', `Give its ${inUse?.total} people another role first.`);
    }
    await tx.delete(roles).where(eq(roles.id, id));
    await audit(tx, ctx, {
      action: 'permission_change',
      entityType: 'role',
      entityId: id,
      context: { deleted: role.name },
    });
    return { id };
  });
}
