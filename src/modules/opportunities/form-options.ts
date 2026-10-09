import 'server-only';

import { assignableOwners } from '@/modules/contacts/owners';
import { listContactOptions } from '@/modules/contacts/queries';
import { listActiveLeadSources } from '@/modules/lead-sources/queries';
import { listActiveMembers } from '@/modules/members/queries';
import { listOrganizationOptions } from '@/modules/organizations/queries';
import { listPartnerOptions } from '@/modules/partners/queries';
import { getPipelineConfig } from '@/modules/pipelines/queries';
import { hasPermission, type TenantContext } from '@/server/context';

/** Everything the opportunity form's pickers need, in one round of parallel queries. */
export async function getOpportunityFormOptions(ctx: TenantContext) {
  const [contacts, organizations, pipeline, members, sources, partners] = await Promise.all([
    listContactOptions(ctx),
    hasPermission(ctx, 'organizations.view') ? listOrganizationOptions(ctx) : Promise.resolve([]),
    getPipelineConfig(ctx),
    listActiveMembers(ctx),
    listActiveLeadSources(ctx),
    listPartnerOptions(ctx),
  ]);
  const owners = assignableOwners(ctx, members, 'opportunities.assign');
  return {
    contacts: contacts.map((c) => ({ value: c.id, label: c.name })),
    organizations: organizations.map((o) => ({ value: o.id, label: o.name })),
    stages: pipeline.stages
      .filter((s) => s.isActive && s.category === 'open')
      .map((s) => ({ value: s.id, label: s.name })),
    owners,
    sources: sources.map((s) => ({ value: s.id, label: s.name })),
    partners: partners.map((p) => ({ value: p.id, label: p.name })),
    canAssign: owners.length > 1,
  };
}
