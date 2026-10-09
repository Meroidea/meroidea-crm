import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/data/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { AppError } from '@/lib/errors';
import { canAccess } from '@/lib/permissions/scope';
import { OpportunityForm } from '@/modules/opportunities/components/opportunity-form';
import { getOpportunityFormOptions } from '@/modules/opportunities/form-options';
import { getOpportunity } from '@/modules/opportunities/queries';
import { hasPermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Edit opportunity' };

export default async function EditOpportunityPage({
  params,
}: PageProps<'/opportunities/[id]/edit'>) {
  const ctx = await requireTenantContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const opportunity = await getOpportunity(ctx, id).catch((error: unknown) => {
    if (error instanceof AppError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN'))
      notFound();
    throw error;
  });
  if (
    !hasPermission(ctx, 'opportunities.edit') ||
    !canAccess(ctx, 'opportunities.edit', opportunity)
  )
    notFound();
  const options = await getOpportunityFormOptions(ctx);
  const mayReassign =
    hasPermission(ctx, 'opportunities.assign') &&
    canAccess(ctx, 'opportunities.assign', opportunity);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <PageHeader title={`Edit ${opportunity.name}`} />
      <Card>
        <CardContent>
          <OpportunityForm
            opportunityId={opportunity.id}
            labels={ctx.tenant.labels}
            {...options}
            canAssign={mayReassign && options.canAssign}
            canViewRevenue={opportunity.canViewRevenue}
            currency={opportunity.currency ?? ctx.tenant.currency}
            defaults={{
              name: opportunity.name,
              contactId: opportunity.contactId,
              organizationId: opportunity.organizationId ?? '',
              amount: opportunity.amount ?? '',
              expectedCloseDate: opportunity.expectedCloseDate ?? '',
              ownerUserId: opportunity.ownerUserId ?? '',
              sourceId: opportunity.sourceId ?? '',
              partnerId: opportunity.partnerId ?? '',
              stageId: '',
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
