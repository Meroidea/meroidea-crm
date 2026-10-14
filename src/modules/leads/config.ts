import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import {
  customFieldDefinitions,
  leadReasons,
  leadSources,
  leadStatuses,
  leadSubSources,
} from '@/db/schema';
import { AppError } from '@/lib/errors';
import type { TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import { readCrmSettings, type CrmSettings } from './settings';

export type LeadStatusKind =
  'new' | 'working' | 'pending_acceptance' | 'returned' | 'converted' | 'closed';

export type LeadStatus = {
  id: string;
  name: string;
  kind: LeadStatusKind;
  leadType: 'b2b' | 'b2c' | null;
  requiresReason: boolean;
  isSystem: boolean;
  color: string | null;
  isActive: boolean;
  position: number;
};

export type LeadReason = {
  id: string;
  kind: 'disqualify' | 'reject';
  name: string;
  isActive: boolean;
};

export type SourceTree = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  subSources: { id: string; name: string; isActive: boolean }[];
}[];

export type LeadConfig = {
  settings: CrmSettings;
  statuses: LeadStatus[];
  reasons: LeadReason[];
  sources: SourceTree;
  /** Custom contact fields, for completeness and handover requirements. */
  customContactFields: { key: string; label: string }[];
};

export async function loadLeadConfig(tx: Tx, ctx: Pick<TenantContext, 'tenantId' | 'tenant'>) {
  const [statuses, reasons, sources, subSources, custom] = await Promise.all([
    tx
      .select({
        id: leadStatuses.id,
        name: leadStatuses.name,
        kind: leadStatuses.kind,
        leadType: leadStatuses.leadType,
        requiresReason: leadStatuses.requiresReason,
        isSystem: leadStatuses.isSystem,
        color: leadStatuses.color,
        isActive: leadStatuses.isActive,
        position: leadStatuses.position,
      })
      .from(leadStatuses)
      .where(eq(leadStatuses.tenantId, ctx.tenantId))
      .orderBy(asc(leadStatuses.position), asc(leadStatuses.name)),
    tx
      .select({
        id: leadReasons.id,
        kind: leadReasons.kind,
        name: leadReasons.name,
        isActive: leadReasons.isActive,
      })
      .from(leadReasons)
      .where(eq(leadReasons.tenantId, ctx.tenantId))
      .orderBy(asc(leadReasons.position), asc(leadReasons.name)),
    tx
      .select({
        id: leadSources.id,
        name: leadSources.name,
        type: leadSources.type,
        isActive: leadSources.isActive,
      })
      .from(leadSources)
      .where(eq(leadSources.tenantId, ctx.tenantId))
      .orderBy(asc(leadSources.position), asc(leadSources.name)),
    tx
      .select({
        id: leadSubSources.id,
        sourceId: leadSubSources.sourceId,
        name: leadSubSources.name,
        isActive: leadSubSources.isActive,
      })
      .from(leadSubSources)
      .where(eq(leadSubSources.tenantId, ctx.tenantId))
      .orderBy(asc(leadSubSources.position), asc(leadSubSources.name)),
    tx
      .select({ key: customFieldDefinitions.key, label: customFieldDefinitions.label })
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.tenantId, ctx.tenantId),
          eq(customFieldDefinitions.entityType, 'contact'),
          eq(customFieldDefinitions.isActive, true),
        ),
      )
      .orderBy(asc(customFieldDefinitions.position)),
  ]);

  return {
    settings: readCrmSettings(ctx.tenant.settings),
    statuses,
    reasons,
    sources: sources.map((source) => ({
      ...source,
      subSources: subSources
        .filter((sub) => sub.sourceId === source.id)
        .map(({ id, name, isActive }) => ({ id, name, isActive })),
    })),
    customContactFields: custom,
  } satisfies LeadConfig;
}

export async function getLeadConfig(ctx: TenantContext): Promise<LeadConfig> {
  return withRls(ctx, (tx) => loadLeadConfig(tx, ctx));
}

/**
 * The status the system moves a lead into for a kind: the one made for this workflow, else the
 * shared one. Every business has these from provisioning; missing one is a setup fault.
 */
export function systemStatus(
  config: Pick<LeadConfig, 'statuses'>,
  kind: LeadStatusKind,
  leadType: 'b2b' | 'b2c' | null,
): LeadStatus {
  const match =
    config.statuses.find((s) => s.isSystem && s.kind === kind && s.leadType === leadType) ??
    config.statuses.find((s) => s.isSystem && s.kind === kind && s.leadType === null);
  if (!match)
    throw new AppError('INTERNAL', 'This workspace is missing a lead status. Ask your admin.');
  return match;
}

/** Statuses a person may pick by hand for a lead of this type: working and closing ones. */
export function pickableStatuses(
  config: Pick<LeadConfig, 'statuses'>,
  leadType: 'b2b' | 'b2c' | null,
) {
  return config.statuses.filter(
    (status) =>
      status.isActive &&
      (status.kind === 'new' || status.kind === 'working' || status.kind === 'closed') &&
      (status.leadType === null || status.leadType === leadType),
  );
}

/** Checks a source and sub-source pair against the business's lists for a new or edited lead. */
export function validateSource(
  config: Pick<LeadConfig, 'sources'>,
  sourceId: string | null,
  subSourceId: string | null,
  options: {
    required: boolean;
    previous?: { sourceId: string | null; subSourceId: string | null };
  },
): void {
  if (!sourceId) {
    if (options.required) {
      throw new AppError('VALIDATION', 'Choose where this lead came from.', {
        sourceId: ['Choose a source'],
      });
    }
    if (subSourceId) {
      throw new AppError('VALIDATION', 'Choose the source first.', { sourceId: ['Required'] });
    }
    return;
  }
  const source = config.sources.find((candidate) => candidate.id === sourceId);
  const unchanged = options.previous?.sourceId === sourceId;
  if (!source || (!source.isActive && !unchanged)) {
    throw new AppError('VALIDATION', 'That source isn’t available.', { sourceId: ['Invalid'] });
  }
  const activeSubs = source.subSources.filter((sub) => sub.isActive);
  if (subSourceId) {
    const sub = source.subSources.find((candidate) => candidate.id === subSourceId);
    const subUnchanged = unchanged && options.previous?.subSourceId === subSourceId;
    if (!sub || (!sub.isActive && !subUnchanged)) {
      throw new AppError('VALIDATION', 'Choose a sub-source of that source.', {
        subSourceId: ['Invalid'],
      });
    }
  } else if (options.required && activeSubs.length > 0) {
    throw new AppError('VALIDATION', `Choose which ${source.name.toLowerCase()} channel.`, {
      subSourceId: ['Choose a sub-source'],
    });
  }
}
