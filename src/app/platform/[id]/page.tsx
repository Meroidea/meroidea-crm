import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { BUSINESS_TYPES } from '@/lib/features';
import { BusinessControls, BusinessLocation } from '@/modules/platform/components/platform-tools';
import { getBusiness } from '@/modules/platform/service';
import { requirePlatformAdmin } from '@/server/platform';

export const metadata: Metadata = { title: 'Business' };

export default async function BusinessPage({ params }: PageProps<'/platform/[id]'>) {
  const admin = await requirePlatformAdmin();
  const parsed = z.object({ id: z.uuid() }).safeParse(await params);
  const business = parsed.success ? await getBusiness(admin, parsed.data.id) : null;
  if (!business) notFound();

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
          <Badge variant={business.status === 'suspended' ? 'destructive' : 'outline'}>
            {business.status === 'suspended' ? 'Suspended' : 'Active'}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {BUSINESS_TYPES.find((type) => type.key === business.industry)?.label ?? 'Type not set'} ·{' '}
          {business.members} {business.members === 1 ? 'person' : 'people'}
        </p>
      </div>
      <BusinessControls
        // Remounted when saved, so the tick-boxes start from what is stored.
        key={business.features.join()}
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
    </div>
  );
}
