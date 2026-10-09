import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/data/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { AppError } from '@/lib/errors';
import { OrganizationForm } from '@/modules/organizations/components/organization-form';
import { countOrganizationsByType, getOrganization } from '@/modules/organizations/queries';
import { hasPermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Edit organization' };

export default async function EditOrganizationPage({
  params,
}: PageProps<'/organizations/[id]/edit'>) {
  const ctx = await requireTenantContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !hasPermission(ctx, 'organizations.manage')) notFound();

  const [org, types] = await Promise.all([
    getOrganization(ctx, id).catch((error: unknown) => {
      if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
      throw error;
    }),
    countOrganizationsByType(ctx, {}),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <PageHeader title={`Edit ${org.name}`} />
      <Card>
        <CardContent>
          <OrganizationForm
            organizationId={org.id}
            label={ctx.tenant.labels.organization}
            knownTypes={types.map((row) => row.type).filter((type) => type !== 'none')}
            defaults={{
              name: org.name,
              type: org.type ?? '',
              email: org.email ?? '',
              phone: org.phone ?? '',
              website: org.website ?? '',
              addressLine: org.addressLine ?? '',
              city: org.city ?? '',
              region: org.region ?? '',
              country: org.country ?? '',
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
