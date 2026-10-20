import 'server-only';

import { assignableOwners } from '@/modules/contacts/owners';
import { listActiveLeadSources } from '@/modules/lead-sources/queries';
import { listActiveMembers } from '@/modules/members/queries';
import { listPartnerOptions } from '@/modules/partners/queries';
import { getCustomFields } from '@/modules/custom-fields/queries';
import { getPipelineConfig, getPipelineSummaries } from '@/modules/pipelines/queries';
import { hasPermission, type TenantContext } from '@/server/context';

/** Everything the opportunity form's pickers need, in one round of parallel queries. */
export async function getOpportunityFormOptions(ctx: TenantContext) {
  // Contacts and organizations are searched by the form's pickers, not sent here whole.
  const [pipeline, members, sources, partners, summaries, customFields] = await Promise.all([
    getPipelineConfig(ctx),
    listActiveMembers(ctx),
    listActiveLeadSources(ctx),
    listPartnerOptions(ctx),
    getPipelineSummaries(ctx),
    getCustomFields(ctx, 'opportunity'),
  ]);
  const active = summaries.filter((summary) => summary.isActive);
  // Stages a new opportunity may start in: open ones, and of those, ones needing approval only
  // for someone who could give it (openOpportunity enforces the same).
  const canApprove = hasPermission(ctx, 'opportunities.approve');
  const startable = (s: { isActive: boolean; category: string; requiresApproval: boolean }) =>
    s.isActive && s.category === 'open' && (canApprove || !s.requiresApproval);
  const pipelines =
    active.length > 1
      ? await Promise.all(
          active.map(async (summary) => {
            const config =
              summary.id === pipeline.id ? pipeline : await getPipelineConfig(ctx, summary.id);
            return {
              value: summary.id,
              label: summary.name,
              stages: config.stages.filter(startable).map((s) => ({ value: s.id, label: s.name })),
            };
          }),
        )
      : [];
  const owners = assignableOwners(ctx, members, 'opportunities.assign');
  return {
    canPickOrganization: hasPermission(ctx, 'organizations.view'),
    stages: pipeline.stages.filter(startable).map((s) => ({ value: s.id, label: s.name })),
    owners,
    sources: sources.map((s) => ({ value: s.id, label: s.name })),
    partners: partners.map((p) => ({ value: p.id, label: p.name })),
    pipelines,
    defaultPipelineId: pipeline.id,
    customFields,
    canAssign: owners.length > 1,
  };
}
