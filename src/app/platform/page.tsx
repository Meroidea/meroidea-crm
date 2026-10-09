import { Building2, Plus } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BUSINESS_TYPES, FEATURES } from '@/lib/features';
import { formatCalendarDate } from '@/lib/format';
import { listBusinesses } from '@/modules/platform/service';
import { requirePlatformAdmin } from '@/server/platform';

export default async function PlatformPage() {
  const admin = await requirePlatformAdmin();
  const businesses = await listBusinesses(admin);
  const typeLabel = (key: string | null) =>
    BUSINESS_TYPES.find((type) => type.key === key)?.label ?? key ?? 'Not set';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Businesses"
        description="Every business on Meroidea. Only platform owners can see this page."
        actions={
          <Button asChild>
            <Link href="/platform/new">
              <Plus aria-hidden /> Onboard a business
            </Link>
          </Button>
        }
      />
      {businesses.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={Building2}
            title="No businesses yet"
            description="Onboard your first client to get started."
          />
        </div>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {businesses.map((business) => (
            <li key={business.id}>
              <Link
                href={`/platform/${business.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <span className="min-w-0 flex-1 basis-56">
                  <span className="block truncate font-medium">{business.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {typeLabel(business.industry)} · {business.members}{' '}
                    {business.members === 1 ? 'person' : 'people'} · since{' '}
                    {formatCalendarDate(business.createdAt.toISOString().slice(0, 10))}
                  </span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {business.features.length === 0 ? (
                    <Badge variant="outline">No features</Badge>
                  ) : (
                    FEATURES.filter((feature) => business.features.includes(feature.key)).map(
                      (feature) => (
                        <Badge key={feature.key} variant="secondary">
                          {feature.label}
                        </Badge>
                      ),
                    )
                  )}
                </span>
                {business.status === 'suspended' && <Badge variant="destructive">Suspended</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
