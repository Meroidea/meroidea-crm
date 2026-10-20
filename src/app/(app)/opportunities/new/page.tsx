import type { Metadata } from 'next';

import { PageHeader } from '@/components/data/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { OpportunityForm } from '@/modules/opportunities/components/opportunity-form';
import { searchContactOptions } from '@/modules/contacts/queries';
import { getOpportunityFormOptions } from '@/modules/opportunities/form-options';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'New opportunity' };

export default async function NewOpportunityPage({
  searchParams,
}: PageProps<'/opportunities/new'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'opportunities.create');
  const params = await searchParams;
  const contactId = typeof params.contact === 'string' ? params.contact : '';
  // A contact named in the link (from its page) starts chosen, if the viewer may see it.
  const [options, preset] = await Promise.all([
    getOpportunityFormOptions(ctx),
    contactId && /^[0-9a-f-]{36}$/i.test(contactId)
      ? searchContactOptions(ctx, { ids: [contactId] })
      : Promise.resolve([]),
  ]);
  const labels = ctx.tenant.labels;

  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <PageHeader title={`New ${labels.opportunity.singular.toLowerCase()}`} />
      <Card>
        <CardContent>
          <OpportunityForm
            labels={labels}
            {...options}
            contactLabel={preset[0]?.label}
            canViewRevenue={hasPermission(ctx, 'revenue.view')}
            currency={ctx.tenant.currency}
            defaults={{
              name: '',
              contactId: preset[0]?.value ?? '',
              organizationId: '',
              amount: '',
              expectedCloseDate: '',
              ownerUserId: ctx.userId,
              sourceId: '',
              partnerId: '',
              pipelineId: options.defaultPipelineId,
              stageId: options.stages[0]?.value ?? '',
              product: '',
              probability: '',
              nextStep: '',
              customFields: {},
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
