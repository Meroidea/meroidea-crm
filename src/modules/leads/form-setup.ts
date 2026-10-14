import 'server-only';

import { scopeDecision } from '@/lib/permissions/scope';
import type { SourceOption } from '@/modules/contacts/components/contact-form';
import { getCustomFields } from '@/modules/custom-fields/queries';
import type { TenantContext } from '@/server/context';

import { getLeadConfig } from './config';
import { allowedLeadTypes } from './settings';

/**
 * What the contact form needs to capture a lead the business's way: its active sources with
 * their sub-sources (plus the record's current ones, even if since switched off), the workflows
 * it runs, and its own contact fields.
 */
export async function contactFormSetup(
  ctx: TenantContext,
  current: { sourceId: string | null; subSourceId: string | null } = {
    sourceId: null,
    subSourceId: null,
  },
) {
  const [config, customFields] = await Promise.all([
    getLeadConfig(ctx),
    getCustomFields(ctx, 'contact'),
  ]);
  const sources: SourceOption[] = config.sources
    .filter((source) => source.isActive || source.id === current.sourceId)
    .map((source) => ({
      id: source.id,
      name: source.name,
      subSources: source.subSources
        .filter((sub) => sub.isActive || sub.id === current.subSourceId)
        .map((sub) => ({ id: sub.id, name: sub.name })),
    }));
  return {
    sources,
    leadTypes: allowedLeadTypes(config.settings),
    customFields,
    canQueue: scopeDecision(ctx, 'contacts.assign').kind === 'all',
  };
}
