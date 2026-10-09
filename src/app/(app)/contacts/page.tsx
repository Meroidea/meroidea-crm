import { Plus, Users } from 'lucide-react';
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
import { formatDate } from '@/lib/format';
import { listActiveLeadSources } from '@/modules/lead-sources/queries';
import { listActiveMembers } from '@/modules/members/queries';
import { ContactsTable } from '@/modules/contacts/components/contacts-table';
import { countContactsByStatus, listContacts } from '@/modules/contacts/queries';
import {
  CONTACT_STATUS_LABELS,
  CONTACT_STATUSES,
  contactListFiltersSchema,
  type ContactStatus,
} from '@/modules/contacts/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Contacts' };

const STATUS_TONE: Record<ContactStatus, CountTone> = {
  active: 'primary',
  inactive: 'muted',
  do_not_contact: 'destructive',
};

export default async function ContactsPage({ searchParams }: PageProps<'/contacts'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'contacts.view');
  const label = ctx.tenant.labels.contact;

  const filters = contactListFiltersSchema.parse(await searchParams);
  const [page, counts, members, sources] = await Promise.all([
    listContacts(ctx, filters),
    countContactsByStatus(ctx, filters),
    listActiveMembers(ctx),
    listActiveLeadSources(ctx),
  ]);

  const current = {
    q: filters.q,
    status: filters.status,
    source: filters.source,
    owner: filters.owner,
    cursor: filters.cursor,
  };
  const statusItems = [
    {
      key: 'all',
      label: 'All',
      count: counts.all,
      href: withParams('/contacts', current, { status: undefined }),
      active: !filters.status,
      tone: 'info' as const,
    },
    ...CONTACT_STATUSES.map((status) => ({
      key: status,
      label: CONTACT_STATUS_LABELS[status],
      count: counts[status],
      href: withParams('/contacts', current, { status }),
      active: filters.status === status,
      tone: STATUS_TONE[status],
    })),
  ];
  const isFiltered = Boolean(filters.q || filters.status || filters.source || filters.owner);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <PageHeader
        title={label.plural}
        description={`Everyone your team works with. ${counts.all.toLocaleString('en-AU')} in view.`}
        actions={
          hasPermission(ctx, 'contacts.create') && (
            <Button asChild>
              <Link href="/contacts/new">
                <Plus aria-hidden /> New {label.singular.toLowerCase()}
              </Link>
            </Button>
          )
        }
      />

      <StatusCountBar label={`${label.plural} by status`} items={statusItems} />

      <FilterBar
        filters={current}
        searchLabel={`Search ${label.plural.toLowerCase()} by name, email or phone`}
        selects={[
          {
            name: 'owner',
            label: 'Owner',
            allLabel: 'Any owner',
            options: [
              { value: 'me', label: 'Me' },
              { value: 'unassigned', label: 'Unassigned' },
              ...members
                .filter((member) => member.userId !== ctx.userId)
                .map((member) => ({ value: member.userId, label: member.fullName })),
            ],
          },
          {
            name: 'source',
            label: 'Source',
            allLabel: 'Any source',
            options: sources.map((source) => ({ value: source.id, label: source.name })),
          },
        ]}
      />

      <Card className="gap-0 overflow-hidden py-0">
        {page.items.length === 0 ? (
          <EmptyState
            icon={Users}
            title={
              isFiltered
                ? `No ${label.plural.toLowerCase()} match`
                : `No ${label.plural.toLowerCase()} yet`
            }
            description={
              isFiltered
                ? 'Try a different search or clear the filters.'
                : `Add your first ${label.singular.toLowerCase()} to start tracking the people you work with.`
            }
            action={
              !isFiltered && hasPermission(ctx, 'contacts.create') ? (
                <Button asChild>
                  <Link href="/contacts/new">
                    <Plus aria-hidden /> New {label.singular.toLowerCase()}
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ContactsTable
            rows={page.items.map((row) => ({
              ...row,
              createdLabel: formatDate(ctx, row.createdAt),
              isMine: row.ownerUserId === ctx.userId,
            }))}
          />
        )}
        <ListPagination
          pathname="/contacts"
          filters={current}
          nextCursor={page.nextCursor}
          shown={page.items.length}
        />
      </Card>
    </div>
  );
}
