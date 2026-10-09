import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Handshake,
  Pencil,
  Radio,
  UserRound,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { Avatar } from '@/components/data/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { daysBetween } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { formatCalendarDate, formatDate, formatMoney } from '@/lib/format';
import { canAccess } from '@/lib/permissions/scope';
import { ActivityComposer } from '@/modules/activities/components/activity-composer';
import { Timeline } from '@/modules/activities/components/timeline';
import { getTimeline } from '@/modules/activities/queries';
import { assignableOwners } from '@/modules/contacts/owners';
import { listActiveMembers } from '@/modules/members/queries';
import { OpportunityActions } from '@/modules/opportunities/components/opportunity-actions';
import { StageBadge } from '@/modules/opportunities/components/stage-badge';
import { StageStepper } from '@/modules/opportunities/components/stage-stepper';
import { getOpportunity } from '@/modules/opportunities/queries';
import { getPipelineConfig } from '@/modules/pipelines/queries';
import { TaskList } from '@/modules/tasks/components/task-list';
import { TaskQuickAdd } from '@/modules/tasks/components/task-quick-add';
import { listTasksFor } from '@/modules/tasks/queries';
import { hasPermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Opportunity' };

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof UserRound;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <Icon aria-hidden className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="truncate text-sm font-medium">{children}</div>
      </div>
    </div>
  );
}

export default async function OpportunityPage({ params }: PageProps<'/opportunities/[id]'>) {
  const ctx = await requireTenantContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const opportunity = await getOpportunity(ctx, id).catch((error: unknown) => {
    if (error instanceof AppError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN'))
      notFound();
    throw error;
  });
  const [pipeline, timeline, tasks, members] = await Promise.all([
    getPipelineConfig(ctx),
    getTimeline(ctx, { opportunityId: id }),
    listTasksFor(ctx, { opportunityId: id }),
    listActiveMembers(ctx),
  ]);

  const labels = ctx.tenant.labels;
  const canEdit =
    hasPermission(ctx, 'opportunities.edit') && canAccess(ctx, 'opportunities.edit', opportunity);
  const canDelete =
    hasPermission(ctx, 'opportunities.delete') &&
    canAccess(ctx, 'opportunities.delete', opportunity);
  const canManageTasks = hasPermission(ctx, 'tasks.manage');
  const assignees = hasPermission(ctx, 'tasks.assign_others')
    ? assignableOwners(ctx, members, 'tasks.manage')
    : undefined;
  const currency = opportunity.currency ?? ctx.tenant.currency;
  const daysInStage = daysBetween(new Date(opportunity.stageEnteredAt), new Date());

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <Link
        href="/pipeline"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> Pipeline
      </Link>

      <header className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{opportunity.name}</h1>
            <StageBadge name={opportunity.stageName} color={opportunity.stageColor} />
          </div>
          <p className="text-sm text-muted-foreground">
            {opportunity.status === 'open'
              ? `${daysInStage} ${daysInStage === 1 ? 'day' : 'days'} in ${opportunity.stageName}`
              : opportunity.status === 'won'
                ? `Won ${formatDate(ctx, opportunity.closedAt)}`
                : `Lost ${formatDate(ctx, opportunity.closedAt)}${opportunity.lostReasonName ? ` · ${opportunity.lostReasonName}` : ''}`}
            {' · '}created {formatDate(ctx, opportunity.createdAt)}
          </p>
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <Button asChild>
              <Link href={`/opportunities/${opportunity.id}/edit`}>
                <Pencil aria-hidden /> Edit
              </Link>
            </Button>
          )}
          <OpportunityActions id={opportunity.id} name={opportunity.name} canDelete={canDelete} />
        </div>
      </header>

      <StageStepper
        opportunityId={opportunity.id}
        stages={pipeline.stages
          .filter((stage) => stage.isActive)
          .map(({ id: stageId, name, category, color }) => ({
            id: stageId,
            name,
            category,
            color,
          }))}
        currentStageId={opportunity.stageId}
        lostReasons={pipeline.lostReasons}
        canEdit={canEdit}
      />

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Fact icon={Radio} label="Value">
            {opportunity.canViewRevenue ? (
              <span className="tabular-nums">{formatMoney(opportunity.amount, currency)}</span>
            ) : (
              <span className="text-muted-foreground italic">Hidden</span>
            )}
          </Fact>
          <Fact icon={UserRound} label={labels.contact.singular}>
            <Link
              href={`/contacts/${opportunity.contactId}`}
              className="hover:text-primary hover:underline"
            >
              {opportunity.contactName}
            </Link>
          </Fact>
          <Fact icon={Building2} label={labels.organization.singular}>
            {opportunity.organizationId ? (
              <Link
                href={`/organizations/${opportunity.organizationId}`}
                className="hover:text-primary hover:underline"
              >
                {opportunity.organizationName}
              </Link>
            ) : (
              '—'
            )}
          </Fact>
          <Fact icon={CalendarDays} label="Expected close">
            {formatCalendarDate(opportunity.expectedCloseDate)}
          </Fact>
          <Fact icon={Handshake} label="Source">
            {opportunity.partnerName
              ? `${opportunity.partnerName} (${labels.partner.singular.toLowerCase()})`
              : (opportunity.sourceName ?? '—')}
          </Fact>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-4">
          {hasPermission(ctx, 'activities.create') && (
            <ActivityComposer opportunityId={opportunity.id} />
          )}
          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <Timeline
                items={timeline}
                timezone={ctx.tenant.timezone}
                emptyText="No activity yet — log the first call or note above."
              />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Next steps</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {canManageTasks && (
                <TaskQuickAdd
                  opportunityId={opportunity.id}
                  currentUserId={ctx.userId}
                  assignees={assignees}
                />
              )}
              <TaskList
                tasks={tasks}
                timezone={ctx.tenant.timezone}
                showRecord={false}
                showAssignee
                emptyText="No follow-up scheduled. Every open deal should have a next step."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Owner</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-3">
              <Avatar name={opportunity.ownerName ?? 'Unassigned'} className="size-9 text-xs" />
              <div>
                <p className="text-sm font-medium">{opportunity.ownerName ?? 'Unassigned'}</p>
                <p className="text-xs text-muted-foreground">
                  {opportunity.ownerUserId === ctx.userId ? 'That’s you' : 'Owner'}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stage history</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-2.5">
                {[...opportunity.history].reverse().map((visit) => {
                  const days = daysBetween(
                    new Date(visit.enteredAt),
                    visit.exitedAt ? new Date(visit.exitedAt) : new Date(),
                  );
                  return (
                    <li
                      key={`${visit.stageId}-${new Date(visit.enteredAt).toISOString()}`}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={`size-2 shrink-0 rounded-full ${visit.exitedAt ? 'bg-muted-foreground/40' : 'bg-primary'}`}
                        />
                        <span className="truncate">{visit.stageName}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDate(ctx, visit.enteredAt)} · {days}d
                        {visit.exitedAt ? '' : ' so far'}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
