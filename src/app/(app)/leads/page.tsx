import { Inbox, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { FilterBar } from '@/components/data/filter-bar';
import { ListPagination } from '@/components/data/list-pagination';
import { PageHeader } from '@/components/data/page-header';
import { StatusCountBar } from '@/components/data/status-count-bar';
import { withParams } from '@/components/data/url';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import { assignableOwners } from '@/modules/contacts/owners';
import { LeadsTable } from '@/modules/leads/components/leads-table';
import { getLeadConfig } from '@/modules/leads/config';
import { countLeadViews, LEAD_VIEWS, listLeads, type LeadView } from '@/modules/leads/queries';
import { leadQueueFiltersSchema } from '@/modules/leads/schemas';
import { allowedLeadTypes } from '@/modules/leads/settings';
import { listActiveMembers } from '@/modules/members/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Leads' };

const VIEW_LABELS: Record<LeadView, string> = {
  mine: 'Mine',
  queue: 'Unassigned',
  pending: 'Awaiting acceptance',
  returned: 'Returned',
  overdue: 'Overdue',
  all: 'All',
};

const VIEW_TONE = {
  mine: 'primary',
  queue: 'info',
  pending: 'info',
  returned: 'muted',
  overdue: 'destructive',
  all: 'muted',
} as const;

export default async function LeadsPage({ searchParams }: PageProps<'/leads'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'contacts.view');
  const filters = leadQueueFiltersSchema.parse(await searchParams);
  const view: LeadView = filters.view ?? 'mine';

  const [page, counts, config, members] = await Promise.all([
    listLeads(ctx, { ...filters, view }),
    countLeadViews(ctx, filters),
    getLeadConfig(ctx),
    listActiveMembers(ctx),
  ]);
  const current = {
    view: filters.view,
    q: filters.q,
    status: filters.status,
    source: filters.source,
    type: filters.type,
    owner: filters.owner,
  };
  const types = allowedLeadTypes(config.settings);
  const canAssign = hasPermission(ctx, 'contacts.assign');
  const owners = assignableOwners(ctx, members);
  const isFiltered = Boolean(
    filters.q || filters.status || filters.source || filters.type || filters.owner,
  );

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <PageHeader
        title="Leads"
        description="New enquiries and the people your team is qualifying, from first contact to handover."
        actions={
          hasPermission(ctx, 'contacts.create') && (
            <Button asChild>
              <Link href="/contacts/new">
                <Plus aria-hidden /> New lead
              </Link>
            </Button>
          )
        }
      />

      <StatusCountBar
        label="Lead views"
        items={LEAD_VIEWS.map((key) => ({
          key,
          label: VIEW_LABELS[key],
          count: counts[key],
          href: withParams('/leads', current, {
            view: key === 'mine' ? undefined : key,
            cursor: undefined,
          }),
          active: view === key,
          tone: VIEW_TONE[key],
        }))}
      />

      <FilterBar
        filters={current}
        searchLabel="Search leads by name, email or company"
        selects={[
          {
            name: 'status',
            label: 'Status',
            allLabel: 'Any status',
            options: config.statuses
              .filter((status) => status.isActive)
              .map((status) => ({ value: status.id, label: status.name })),
          },
          {
            name: 'source',
            label: 'Source',
            allLabel: 'Any source',
            options: config.sources.map((source) => ({ value: source.id, label: source.name })),
          },
          ...(types.length > 1
            ? [
                {
                  name: 'type',
                  label: 'Type',
                  allLabel: 'B2B and B2C',
                  options: [
                    { value: 'b2b', label: 'B2B' },
                    { value: 'b2c', label: 'B2C' },
                  ],
                },
              ]
            : []),
          {
            name: 'owner',
            label: 'Owner',
            allLabel: 'Any owner',
            options: members.map((member) => ({ value: member.userId, label: member.fullName })),
          },
        ]}
      />

      <Card className="gap-0 overflow-hidden py-0">
        {page.items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={isFiltered ? 'No leads match' : `Nothing in ${VIEW_LABELS[view].toLowerCase()}`}
            description={
              isFiltered
                ? 'Try a different search or clear the filters.'
                : view === 'mine'
                  ? 'Leads assigned to you, or handed to you to accept, show up here.'
                  : 'All clear.'
            }
          />
        ) : (
          <LeadsTable
            canAssign={canAssign}
            owners={owners}
            rows={page.items.map((row) => ({
              id: row.id,
              fullName: row.fullName,
              companyName: row.companyName,
              leadType: row.leadType,
              statusName: row.statusName,
              statusColor: row.statusColor,
              source: row.sourceName
                ? `${row.sourceName}${row.subSourceName ? ` – ${row.subSourceName}` : ''}`
                : null,
              ownerName: row.ownerName,
              handoverToName: row.handoverToName,
              created: formatDate(ctx, row.createdAt),
              completeness: row.completeness,
              overdue: row.overdue,
            }))}
          />
        )}
        <ListPagination
          pathname="/leads"
          filters={{ ...current, cursor: filters.cursor }}
          nextCursor={page.nextCursor}
          shown={page.items.length}
        />
      </Card>
    </div>
  );
}
