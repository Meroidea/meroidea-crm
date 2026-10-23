import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { BUSINESS_TYPES } from '@/lib/features';
import { formatDateTime } from '@/lib/format';
import {
  AgreementStatus,
  BusinessIdentityForm,
} from '@/modules/platform/components/agreement-tools';
import {
  BusinessControls,
  BusinessLocation,
  DeleteBusiness,
} from '@/modules/platform/components/platform-tools';
import {
  getBusiness,
  getBusinessAgreement,
  type BusinessAgreement,
} from '@/modules/platform/service';
import { businessStatus } from '@/modules/platform/status';
import { requirePlatformAdmin } from '@/server/platform';

export const metadata: Metadata = { title: 'Business' };

function agreementSummary(agreement: BusinessAgreement | null, timezone: string): string {
  if (!agreement) return 'Onboarded before service agreements were recorded. Nothing to accept.';
  const at = (value: Date | null) => formatDateTime({ tenant: { timezone } }, value);
  const which = `${agreement.title} (version ${agreement.version})`;
  if (agreement.acceptedAt) {
    return `${which} accepted by ${agreement.acceptedName} on ${at(agreement.acceptedAt)}.`;
  }
  const expired = !agreement.tokenExpiresAt || agreement.tokenExpiresAt < new Date();
  return `${which} sent to ${agreement.recipientName} (${agreement.recipientEmail}) on ${at(agreement.sentAt)}. ${
    expired
      ? 'The link has expired: send a new one.'
      : `Not accepted yet; the link works until ${at(agreement.tokenExpiresAt)}.`
  }`;
}

export default async function BusinessPage({ params }: PageProps<'/platform/[id]'>) {
  const admin = await requirePlatformAdmin();
  const parsed = z.object({ id: z.uuid() }).safeParse(await params);
  const business = parsed.success ? await getBusiness(admin, parsed.data.id) : null;
  if (!business) notFound();
  const agreement = await getBusinessAgreement(admin, business.id);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link href="/platform" className="underline-offset-4 hover:underline">
            Businesses
          </Link>{' '}
          / {business.name}
        </nav>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{business.name}</h1>
          <Badge variant={businessStatus(business.status).variant}>
            {businessStatus(business.status).label}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {BUSINESS_TYPES.find((type) => type.key === business.industry)?.label ?? 'Type not set'} ·{' '}
          {business.members} {business.members === 1 ? 'person' : 'people'}
        </p>
      </div>
      <AgreementStatus
        tenantId={business.id}
        summary={agreementSummary(agreement, business.timezone)}
        waiting={Boolean(agreement && !agreement.acceptedAt)}
        recipientEmail={agreement?.recipientEmail ?? null}
      />
      <BusinessIdentityForm
        tenantId={business.id}
        initial={{
          companyName: business.name,
          legalName: business.legalName ?? '',
          businessNumber: business.businessNumber ?? '',
          primaryContactName: business.primaryContactName ?? '',
          primaryContactEmail: business.primaryContactEmail ?? '',
          primaryContactPhone: business.primaryContactPhone ?? '',
        }}
      />
      <BusinessControls
        tenantId={business.id}
        initialFeatures={business.features}
        status={business.status}
      />
      <BusinessLocation
        tenantId={business.id}
        latitude={business.locationLatitude}
        longitude={business.locationLongitude}
        radiusMetres={business.clockRadiusMetres}
      />
      <DeleteBusiness
        tenantId={business.id}
        name={business.name}
        suspended={business.status === 'suspended'}
      />
    </div>
  );
}
