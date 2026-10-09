import type { Metadata } from 'next';
import { z } from 'zod';

import { PageHeader } from '@/components/data/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { HireForm } from '@/modules/hiring/components/hire-form';
import { getApplicant, getOpening } from '@/modules/recruitment/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';
import { isFairWorkConfigured } from '@/server/fair-work';

export const metadata: Metadata = { title: 'Hire someone' };

export default async function NewHirePage({ searchParams }: PageProps<'/hiring/new'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'employees.manage');

  // Arriving from recruitment: carry the successful applicant's details into the form.
  const from = z.object({ applicant: z.uuid() }).safeParse(await searchParams);
  const applicant =
    from.success && hasPermission(ctx, 'recruitment.manage')
      ? await getApplicant(ctx, from.data.applicant)
      : null;
  const opening = applicant ? await getOpening(ctx, applicant.jobOpeningId) : null;
  const [firstName = '', ...rest] = applicant?.fullName.trim().split(/\s+/) ?? [];
  const initial = applicant
    ? {
        firstName,
        lastName: rest.join(' '),
        email: applicant.email,
        phone: applicant.phone ?? '',
        positionTitle: applicant.jobTitle,
        // Recruitment advertises a "contract" job; the hire then decides which kind.
        employmentType:
          opening?.employmentType === 'contract'
            ? ('contractor' as const)
            : (opening?.employmentType ?? ('full_time' as const)),
      }
    : undefined;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <PageHeader
        title="Hire someone"
        description="Nothing is sent from this page. You review the contract and any warnings next."
      />
      <Card>
        <CardContent>
          <HireForm
            fairWorkConnected={isFairWorkConfigured()}
            currency={ctx.tenant.currency}
            initial={initial}
          />
        </CardContent>
      </Card>
    </div>
  );
}
