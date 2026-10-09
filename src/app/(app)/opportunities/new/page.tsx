import type { Metadata } from 'next';

import { PageHeader } from '@/components/data/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { OpportunityForm } from '@/modules/opportunities/components/opportunity-form';
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
  const options = await getOpportunityFormOptions(ctx);
  const labels = ctx.tenant.labels;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <PageHeader title={`New ${labels.opportunity.singular.toLowerCase()}`} />
      <Card>
        <CardContent>
          <OpportunityForm
            labels={labels}
            {...options}
            canViewRevenue={hasPermission(ctx, 'revenue.view')}
            currency={ctx.tenant.currency}
            defaults={{
              name: '',
              contactId: options.contacts.some((c) => c.value === contactId) ? contactId : '',
              organizationId: '',
              amount: '',
              expectedCloseDate: '',
              ownerUserId: ctx.userId,
              sourceId: '',
              partnerId: '',
              stageId: options.stages[0]?.value ?? '',
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
