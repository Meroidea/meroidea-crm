import { Palmtree } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { zonedToday } from '@/lib/dates';
import { formatCalendarDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { listActiveMembers } from '@/modules/members/queries';
import {
  LeaveTypeManager,
  RequestActions,
  RequestLeaveButton,
} from '@/modules/timeoff/components/time-off-tools';
import {
  getMyLeaveTotals,
  listLeaveRequests,
  listLeaveTypes,
  type LeaveRequestRow,
} from '@/modules/timeoff/queries';
import { LEAVE_STATUS_LABELS, timeOffParamsSchema } from '@/modules/timeoff/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Time off' };

const STATUS_VARIANT = {
  pending: 'outline',
  approved: 'default',
  declined: 'destructive',
  cancelled: 'secondary',
} as const;

const trimDays = (days: string) => {
  const value = days.includes('.') ? days.replace(/\.?0+$/, '') : days;
  return `${value} ${value === '1' ? 'day' : 'days'}`;
};

function RequestList({
  requests,
  showPerson,
  userId,
  canManage,
}: {
  requests: LeaveRequestRow[];
  showPerson: boolean;
  userId: string;
  canManage: boolean;
}) {
  return (
    <ul className="flex flex-col divide-y rounded-xl border bg-card">
      {requests.map((request) => (
        <li key={request.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {showPerson && <span data-sensitive>{request.personName} · </span>}
              {request.leaveTypeName}
              {!request.isPaid && <span className="text-muted-foreground"> (unpaid)</span>}
            </p>
            <p className="text-sm text-muted-foreground">
              {request.startsOn === request.endsOn
                ? formatCalendarDate(request.startsOn)
                : `${formatCalendarDate(request.startsOn)} to ${formatCalendarDate(request.endsOn)}`}
              {' · '}
              {trimDays(request.days)}
            </p>
            {request.note && <p className="mt-1 text-sm">{request.note}</p>}
            {request.decisionNote && (
              <p className="mt-1 text-sm text-muted-foreground">Manager: {request.decisionNote}</p>
            )}
          </div>
          <Badge variant={STATUS_VARIANT[request.status]}>
            {LEAVE_STATUS_LABELS[request.status]}
          </Badge>
          <RequestActions
            id={request.id}
            canDecide={canManage && request.status === 'pending'}
            canCancel={
              request.status === 'pending'
                ? canManage || request.userId === userId
                : request.status === 'approved' && canManage
            }
          />
        </li>
      ))}
    </ul>
  );
}

export default async function TimeOffPage({ searchParams }: PageProps<'/time-off'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'timeoff.request');
  const canManage = hasPermission(ctx, 'timeoff.manage');
  const requested = timeOffParamsSchema.parse(await searchParams).view ?? 'mine';
  const view = canManage ? requested : 'mine';
  const today = zonedToday(ctx.tenant.timezone);

  const [types, totals, mine, waiting, upcoming, people] = await Promise.all([
    listLeaveTypes(ctx),
    getMyLeaveTotals(ctx, Number(today.slice(0, 4))),
    listLeaveRequests(ctx, { scope: 'mine' }),
    canManage ? listLeaveRequests(ctx, { scope: 'everyone', statuses: ['pending'] }) : [],
    canManage && view === 'team'
      ? listLeaveRequests(ctx, { scope: 'everyone', statuses: ['approved'], from: today })
      : [],
    canManage ? listActiveMembers(ctx) : undefined,
  ]);

  const tabs = [
    { key: 'mine', label: 'My time off' },
    { key: 'team', label: `Team${waiting.length ? ` (${waiting.length} waiting)` : ''}` },
    { key: 'types', label: 'Leave types' },
  ];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <PageHeader
        title="Time off"
        description="Ask for leave, see what has been approved, and who is away."
        actions={
          <RequestLeaveButton
            types={types}
            today={today}
            people={people?.filter((person) => person.userId !== ctx.userId)}
          />
        }
      />

      {canManage && (
        <nav aria-label="Time off views" className="flex gap-1 border-b">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={tab.key === 'mine' ? '/time-off' : `/time-off?view=${tab.key}`}
              aria-current={view === tab.key ? 'page' : undefined}
              className={cn(
                '-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground',
                view === tab.key && 'border-primary font-medium text-foreground',
              )}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      )}

      {view === 'mine' && (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {totals.map((total) => (
              <div key={total.leaveTypeId} className="rounded-xl border bg-card px-4 py-3">
                <dt className="text-xs text-muted-foreground">{total.name}</dt>
                <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
                  {trimDays(total.days)}
                </dd>
                <dd className="text-xs text-muted-foreground">approved this year</dd>
              </div>
            ))}
          </dl>
          {mine.length === 0 ? (
            <div className="rounded-xl border bg-card">
              <EmptyState
                icon={Palmtree}
                title="No time off yet"
                description="When you ask for leave it appears here with the manager's answer."
              />
            </div>
          ) : (
            <RequestList
              requests={mine}
              showPerson={false}
              userId={ctx.userId}
              canManage={canManage}
            />
          )}
        </>
      )}

      {view === 'team' && (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="font-medium">Waiting for a decision</h2>
            {waiting.length === 0 ? (
              <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                Nothing is waiting.
              </p>
            ) : (
              <RequestList requests={waiting} showPerson userId={ctx.userId} canManage />
            )}
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="font-medium">Approved and coming up</h2>
            {upcoming.length === 0 ? (
              <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                Nobody has approved leave coming up.
              </p>
            ) : (
              <RequestList requests={upcoming} showPerson userId={ctx.userId} canManage />
            )}
          </section>
        </>
      )}

      {view === 'types' && (
        <section className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            The kinds of leave your people can ask for. Switch one off to stop new requests without
            losing its history.
          </p>
          <LeaveTypeManager types={types} />
        </section>
      )}
    </div>
  );
}
