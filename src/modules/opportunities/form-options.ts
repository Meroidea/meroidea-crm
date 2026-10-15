import 'server-only';

import { assignableOwners } from '@/modules/contacts/owners';
import { listContactOptions } from '@/modules/contacts/queries';
import { listActiveLeadSources } from '@/modules/lead-sources/queries';
import { listActiveMembers } from '@/modules/members/queries';
import { listOrganizationOptions } from '@/modules/organizations/queries';
import { listPartnerOptions } from '@/modules/partners/queries';
import { getCustomFields } from '@/modules/custom-fields/queries';
import { getPipelineConfig, getPipelineSummaries } from '@/modules/pipelines/queries';
import { hasPermission, type TenantContext } from '@/server/context';

/** Everything the opportunity form's pickers need, in one round of parallel queries. */
export async function getOpportunityFormOptions(ctx: TenantContext) {
  const [contacts, organizations, pipeline, members, sources, partners, summaries, customFields] =
    await Promise.all([
      listContactOptions(ctx),
      hasPermission(ctx, 'organizations.view') ? listOrganizationOptions(ctx) : Promise.resolve([]),
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
    contacts: contacts.map((c) => ({ value: c.id, label: c.name })),
    organizations: organizations.map((o) => ({ value: o.id, label: o.name })),
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
