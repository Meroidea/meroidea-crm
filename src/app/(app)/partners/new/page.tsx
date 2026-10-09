import type { Metadata } from 'next';

import { PageHeader } from '@/components/data/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { listOrganizationOptions } from '@/modules/organizations/queries';
import { PartnerForm } from '@/modules/partners/components/partner-form';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'New partner' };

export default async function NewPartnerPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'partners.manage');
  const organizations = hasPermission(ctx, 'organizations.view')
    ? await listOrganizationOptions(ctx)
    : [];
  const labels = ctx.tenant.labels;
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <PageHeader title={`Add ${labels.partner.singular.toLowerCase()}`} />
      <Card>
        <CardContent>
          <PartnerForm
            organizations={organizations.map((org) => ({ value: org.id, label: org.name }))}
            organizationLabel={labels.organization.singular}
            partnerLabel={labels.partner.singular}
            currency={ctx.tenant.currency}
          />
        </CardContent>
      </Card>
    </div>
  );
}
