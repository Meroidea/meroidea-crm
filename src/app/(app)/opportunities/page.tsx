import { KanbanSquare, Plus, Target } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Avatar } from '@/components/data/avatar';
import { EmptyState } from '@/components/data/empty-state';
import { FilterBar } from '@/components/data/filter-bar';
import { ListPagination } from '@/components/data/list-pagination';
import { PageHeader } from '@/components/data/page-header';
import { StatusCountBar, type CountTone } from '@/components/data/status-count-bar';
import { withParams } from '@/components/data/url';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate, formatMoney } from '@/lib/format';
import { listActiveMembers } from '@/modules/members/queries';
import { StageBadge } from '@/modules/opportunities/components/stage-badge';
import { countOpportunitiesByStage, listOpportunities } from '@/modules/opportunities/queries';
import { opportunityListFiltersSchema } from '@/modules/opportunities/schemas';
import { getPipelineConfig } from '@/modules/pipelines/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Opportunities' };

const TONES: Record<string, CountTone> = { won: 'primary', lost: 'destructive' };

export default async function OpportunitiesPage({ searchParams }: PageProps<'/opportunities'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'opportunities.view');
  const label = ctx.tenant.labels.opportunity;
  const filters = opportunityListFiltersSchema.parse(await searchParams);
  const [page, counts, pipeline, members] = await Promise.all([
    listOpportunities(ctx, filters),
    countOpportunitiesByStage(ctx, filters),
    getPipelineConfig(ctx),
    listActiveMembers(ctx),
  ]);

  const current = {
    q: filters.q,
    stage: filters.stage,
    owner: filters.owner,
    cursor: filters.cursor,
  };
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const items = [
    {
      key: 'all',
      label: 'All',
      count: total,
      href: withParams('/opportunities', current, { stage: undefined }),
      active: !filters.stage,
      tone: 'info' as const,
    },
    ...pipeline.stages
      .filter((stage) => stage.isActive)
      .map((stage) => ({
        key: stage.id,
        label: stage.name,
        count: counts.get(stage.id) ?? 0,
        href: withParams('/opportunities', current, { stage: stage.id }),
        active: filters.stage === stage.id,
        tone: TONES[stage.category] ?? ('chart-3' as const),
      })),
  ];
  const isFiltered = Boolean(filters.q || filters.stage || filters.owner);
  const newButton = hasPermission(ctx, 'opportunities.create') && (
    <Button asChild>
      <Link href="/opportunities/new">
        <Plus aria-hidden /> New {label.singular.toLowerCase()}
      </Link>
    </Button>
  );

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <PageHeader
        title={label.plural}
        description="Every deal, case and journey — in one list."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/pipeline">
                <KanbanSquare aria-hidden /> Board
              </Link>
            </Button>
            {newButton}
          </>
        }
      />
      <StatusCountBar label={`${label.plural} by stage`} items={items} />
      <FilterBar
        filters={current}
        searchLabel={`Search by name or ${ctx.tenant.labels.contact.singular.toLowerCase()}`}
        selects={[
          {
            name: 'owner',
            label: 'Owner',
            allLabel: 'Any owner',
            options: [
              { value: 'me', label: 'Me' },
              { value: 'unassigned', label: 'Unassigned' },
              ...members
                .filter((m) => m.userId !== ctx.userId)
                .map((m) => ({ value: m.userId, label: m.fullName })),
            ],
          },
        ]}
      />
      <Card className="gap-0 overflow-hidden py-0">
        {page.items.length === 0 ? (
          <EmptyState
            icon={Target}
            title={isFiltered ? 'Nothing matches' : `No ${label.plural.toLowerCase()} yet`}
            description={
              isFiltered
                ? 'Try a different search or clear the filters.'
                : `Create your first ${label.singular.toLowerCase()} to start the pipeline.`
            }
            action={!isFiltered ? newButton : undefined}
          />
        ) : (
          <>
            <ul className="divide-y md:hidden">
              {page.items.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/opportunities/${row.id}`}
                    className="flex flex-col gap-1.5 px-4 py-3 active:bg-accent"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{row.name}</span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {row.amount
                          ? formatMoney(row.amount, row.currency ?? ctx.tenant.currency, {
                              compact: true,
                            })
                          : ''}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{row.contactName}</span>
                      <StageBadge name={row.stageName} color={row.stageColor} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Name</TableHead>
                  <TableHead>{ctx.tenant.labels.contact.singular}</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Expected close</TableHead>
                  <TableHead className="pr-4 text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((row) => (
                  <TableRow key={row.id} className="group relative">
                    <TableCell className="max-w-72 pl-4">
                      <Link
                        href={`/opportunities/${row.id}`}
                        className="block truncate font-medium group-hover:text-primary after:absolute after:inset-0"
                      >
                        {row.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.contactName}</TableCell>
                    <TableCell>
                      <StageBadge name={row.stageName} color={row.stageColor} />
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {row.amount
                        ? formatMoney(row.amount, row.currency ?? ctx.tenant.currency)
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Avatar
                          name={row.ownerName ?? 'Unassigned'}
                          className="size-6 text-[9px]"
                        />
                        {row.ownerUserId === ctx.userId ? 'You' : (row.ownerName ?? 'Unassigned')}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.expectedCloseDate ?? '—'}
                    </TableCell>
                    <TableCell className="pr-4 text-right text-muted-foreground tabular-nums">
                      {formatDate(ctx, row.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
        <ListPagination
          pathname="/opportunities"
          filters={current}
          nextCursor={page.nextCursor}
          shown={page.items.length}
        />
      </Card>
    </div>
  );
}
