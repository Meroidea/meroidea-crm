import { Building2, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { FilterBar } from '@/components/data/filter-bar';
import { ListPagination } from '@/components/data/list-pagination';
import { PageHeader } from '@/components/data/page-header';
import { StatusCountBar, type CountTone } from '@/components/data/status-count-bar';
import { withParams } from '@/components/data/url';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { OrganizationsTable } from '@/modules/organizations/components/organizations-table';
import { countOrganizationsByType, listOrganizations } from '@/modules/organizations/queries';
import { organizationListFiltersSchema } from '@/modules/organizations/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Organizations' };

const TONES: CountTone[] = ['primary', 'chart-3', 'info', 'chart-2'];

function typeLabel(type: string) {
  return type === 'none' ? 'No type' : type.charAt(0).toUpperCase() + type.slice(1);
}

export default async function OrganizationsPage({ searchParams }: PageProps<'/organizations'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'organizations.view');
  const labels = ctx.tenant.labels;

  const filters = organizationListFiltersSchema.parse(await searchParams);
  const [page, byType] = await Promise.all([
    listOrganizations(ctx, filters),
    countOrganizationsByType(ctx, filters),
  ]);
  const current = { q: filters.q, type: filters.type, cursor: filters.cursor };
  const total = byType.reduce((sum, row) => sum + row.total, 0);
  const canManage = hasPermission(ctx, 'organizations.manage');

  const items = [
    {
      key: 'all',
      label: 'All',
      count: total,
      href: withParams('/organizations', current, { type: undefined }),
      active: !filters.type,
      tone: 'info' as const,
    },
    ...byType.slice(0, 8).map((row, index) => ({
      key: row.type,
      label: typeLabel(row.type),
      count: row.total,
      href: withParams('/organizations', current, { type: row.type }),
      active: filters.type === row.type,
      tone: row.type === 'none' ? ('muted' as const) : (TONES[index % TONES.length] ?? 'primary'),
    })),
  ];

  const newButton = canManage && (
    <Button asChild>
      <Link href="/organizations/new">
        <Plus aria-hidden /> New {labels.organization.singular.toLowerCase()}
      </Link>
    </Button>
  );

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <PageHeader
        title={labels.organization.plural}
        description="Companies and institutions you work with."
        actions={newButton}
      />
      {total > 0 && (
        <StatusCountBar label={`${labels.organization.plural} by type`} items={items} />
      )}
      <FilterBar
        filters={current}
        searchLabel={`Search ${labels.organization.plural.toLowerCase()} by name or city`}
        selects={[]}
      />
      <Card className="gap-0 overflow-hidden py-0">
        {page.items.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={
              filters.q || filters.type
                ? 'Nothing matches'
                : `No ${labels.organization.plural.toLowerCase()} yet`
            }
            description={
              filters.q || filters.type
                ? 'Try a different search or clear the filters.'
                : `Add the ${labels.organization.plural.toLowerCase()} your ${labels.contact.plural.toLowerCase()} belong to.`
            }
            action={!filters.q && !filters.type ? newButton : undefined}
          />
        ) : (
          <OrganizationsTable rows={page.items} peopleLabel={labels.contact.plural} />
        )}
        <ListPagination
          pathname="/organizations"
          filters={current}
          nextCursor={page.nextCursor}
          shown={page.items.length}
        />
      </Card>
    </div>
  );
}
