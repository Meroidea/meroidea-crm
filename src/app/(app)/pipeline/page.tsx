import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { FilterBar } from '@/components/data/filter-bar';
import { PageHeader } from '@/components/data/page-header';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';
import { listActiveMembers } from '@/modules/members/queries';
import { PipelineBoard } from '@/modules/opportunities/components/pipeline-board';
import { getBoard } from '@/modules/opportunities/queries';
import { opportunityListFiltersSchema } from '@/modules/opportunities/schemas';
import { getPipelineSummaries } from '@/modules/pipelines/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Pipeline' };

export default async function PipelinePage({ searchParams }: PageProps<'/pipeline'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'opportunities.view');
  const filters = opportunityListFiltersSchema.parse(await searchParams);
  const summaries = (await getPipelineSummaries(ctx)).filter((pipeline) => pipeline.isActive);
  const pipelineId = summaries.some((pipeline) => pipeline.id === filters.pipeline)
    ? filters.pipeline
    : undefined;
  const defaultPipeline = summaries.find((pipeline) => pipeline.isDefault);
  const [board, members] = await Promise.all([
    getBoard(ctx, { q: filters.q, owner: filters.owner, pipeline: pipelineId }),
    listActiveMembers(ctx),
  ]);
  const label = ctx.tenant.labels.opportunity;
  const open = board.columns.filter((column) => column.category === 'open');
  const openCount = open.reduce((sum, column) => sum + column.count, 0);

  return (
    <div className="flex w-full flex-col gap-5">
      <PageHeader
        title={board.pipeline.name}
        description={
          <>
            {openCount} open {label.plural.toLowerCase()}
            {board.openTotal !== null &&
              ` · ${formatMoney(board.openTotal, board.currency)} in play`}{' '}
            <span className="hidden md:inline">· drag a card to move it</span>
          </>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/opportunities">List view</Link>
            </Button>
            {hasPermission(ctx, 'opportunities.create') && (
              <Button asChild>
                <Link href="/opportunities/new">
                  <Plus aria-hidden /> New {label.singular.toLowerCase()}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <FilterBar
        filters={{ q: filters.q, owner: filters.owner, pipeline: pipelineId }}
        searchLabel={`Search ${label.plural.toLowerCase()} or ${ctx.tenant.labels.contact.plural.toLowerCase()}`}
        selects={[
          ...(summaries.length > 1
            ? [
                {
                  name: 'pipeline',
                  label: 'Pipeline',
                  allLabel: defaultPipeline?.name ?? 'Default pipeline',
                  options: summaries
                    .filter((pipeline) => !pipeline.isDefault)
                    .map((pipeline) => ({ value: pipeline.id, label: pipeline.name })),
                },
              ]
            : []),
          {
            name: 'owner',
            label: 'Owner',
            allLabel: 'Everyone',
            options: [
              { value: 'me', label: 'Mine' },
              { value: 'unassigned', label: 'Unassigned' },
              ...members
                .filter((m) => m.userId !== ctx.userId)
                .map((m) => ({ value: m.userId, label: m.fullName })),
            ],
          },
        ]}
      />
      <PipelineBoard
        columns={board.columns}
        currency={board.currency}
        lostReasons={board.pipeline.lostReasons}
        canEdit={hasPermission(ctx, 'opportunities.edit')}
      />
    </div>
  );
}
