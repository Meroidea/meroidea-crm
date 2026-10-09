import type { Metadata } from 'next';

import { PageHeader } from '@/components/data/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { OrganizationForm } from '@/modules/organizations/components/organization-form';
import { countOrganizationsByType } from '@/modules/organizations/queries';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'New organization' };

export default async function NewOrganizationPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'organizations.manage');
  const types = await countOrganizationsByType(ctx, {});
  const label = ctx.tenant.labels.organization;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <PageHeader title={`New ${label.singular.toLowerCase()}`} />
      <Card>
        <CardContent>
          <OrganizationForm
            label={label}
            knownTypes={types.map((row) => row.type).filter((type) => type !== 'none')}
            defaults={{
              name: '',
              type: '',
              email: '',
              phone: '',
              website: '',
              addressLine: '',
              city: '',
              region: '',
              country: ctx.tenant.country ?? '',
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
