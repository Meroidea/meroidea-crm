import { ChevronLeft, ChevronRight, Timer } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { addDaysToDate, instantToZoned, mondayOf, zonedToday } from '@/lib/dates';
import { formatCalendarDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { listActiveMembers } from '@/modules/members/queries';
import { dayParts, formatHours } from '@/modules/roster/hours';
import {
  ClockCard,
  EntryActions,
  EntryButton,
} from '@/modules/timesheets/components/timesheet-tools';
import { workedMinutes } from '@/modules/timesheets/minutes';
import { getOpenEntry, listTimeEntries, type TimeEntryRow } from '@/modules/timesheets/queries';
import { ENTRY_STATUS_LABELS, timesheetParamsSchema } from '@/modules/timesheets/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Timesheets' };

const STATUS_VARIANT = {
  pending: 'outline',
  approved: 'default',
  rejected: 'destructive',
} as const;

function EntryRows({
  entries,
  timezone,
  today,
  userId,
  canManage,
  locked,
}: {
  entries: TimeEntryRow[];
  timezone: string;
  today: string;
  userId: string;
  canManage: boolean;
  /** True where time must be clocked at the workplace, so staff cannot edit their own entries. */
  locked: boolean;
}) {
  return (
    <ul className="flex flex-col divide-y">
      {entries.map((entry) => {
        const start = instantToZoned(timezone, entry.clockIn);
        const end = entry.clockOut ? instantToZoned(timezone, entry.clockOut) : null;
        const { weekday, day } = dayParts(start.date);
        const ownWaiting = !locked && entry.userId === userId && entry.status === 'pending';
        return (
          <li key={entry.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
            <p className="w-24 shrink-0 text-sm">
              <span className="font-medium">{weekday}</span>{' '}
              <span className="text-muted-foreground">{day}</span>
            </p>
            <p className="min-w-0 flex-1 text-sm tabular-nums">
              {start.time} – {end ? end.time : 'still clocked in'}
              {entry.breakMinutes > 0 && (
                <span className="text-muted-foreground"> · {entry.breakMinutes} min break</span>
              )}
              {entry.source === 'manual' && (
                <span className="text-muted-foreground"> · added by hand</span>
              )}
              {entry.note && <span className="block text-muted-foreground">{entry.note}</span>}
            </p>
            <p className="w-14 text-right text-sm font-medium tabular-nums">
              {end ? formatHours(workedMinutes(entry)) : '—'}
            </p>
            {end && (
              <Badge variant={STATUS_VARIANT[entry.status]}>
                {ENTRY_STATUS_LABELS[entry.status]}
              </Badge>
            )}
            {end && (
              <div className="flex items-center">
                {(canManage || ownWaiting) && (
                  <EntryButton
                    today={today}
                    entry={{
                      id: entry.id,
                      date: start.date,
                      start: start.time,
                      end: end.time,
                      breakMinutes: String(entry.breakMinutes),
                      note: entry.note ?? '',
                    }}
                  />
                )}
                <EntryActions
                  ids={[entry.id]}
                  status={entry.status}
                  canDecide={canManage}
                  canDelete={canManage || ownWaiting}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const totalOf = (entries: TimeEntryRow[], statuses: TimeEntryRow['status'][]) =>
  entries
    .filter((entry) => statuses.includes(entry.status))
    .reduce((sum, entry) => sum + workedMinutes(entry), 0);

export default async function TimesheetsPage({ searchParams }: PageProps<'/timesheets'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'timesheets.clock');
  const canManage = hasPermission(ctx, 'timesheets.manage');
  const params = timesheetParamsSchema.parse(await searchParams);
  const view = canManage ? (params.view ?? 'mine') : 'mine';
  const timezone = ctx.tenant.timezone;
  const today = zonedToday(timezone);
  const weekStart = mondayOf(params.week ?? today);
  const weekEnd = addDaysToDate(weekStart, 6);

  const [open, entries, people] = await Promise.all([
    getOpenEntry(ctx),
    listTimeEntries(ctx, {
      scope: view === 'team' ? 'everyone' : 'mine',
      from: weekStart,
      to: weekEnd,
    }),
    canManage ? listActiveMembers(ctx) : undefined,
  ]);

  const href = (changes: { view?: string; week?: string }) => {
    const query = new URLSearchParams();
    const nextView = changes.view ?? view;
    const nextWeek = changes.week ?? weekStart;
    if (nextView !== 'mine') query.set('view', nextView);
    if (nextWeek !== mondayOf(today)) query.set('week', nextWeek);
    const text = query.toString();
    return text ? `/timesheets?${text}` : '/timesheets';
  };

  const byPerson = new Map<string, TimeEntryRow[]>();
  for (const entry of entries) {
    byPerson.set(entry.userId, [...(byPerson.get(entry.userId) ?? []), entry]);
  }
  const waitingIds = entries
    .filter((entry) => entry.status === 'pending' && entry.clockOut)
    .map((entry) => entry.id);
  const openLabel = open ? instantToZoned(timezone, open.clockIn) : null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <PageHeader
        title="Timesheets"
        description="Clock in and out, and see the hours that go to pay."
        actions={
          (canManage || !ctx.tenant.clockLocation) && (
            <EntryButton
              today={today}
              people={people?.filter((person) => person.userId !== ctx.userId)}
            />
          )
        }
      />

      <ClockCard
        workplaceRadius={ctx.tenant.clockLocation?.radiusMetres ?? null}
        open={
          open && openLabel
            ? {
                since: open.clockIn.getTime(),
                label:
                  openLabel.date === today
                    ? openLabel.time
                    : `${openLabel.time} on ${formatCalendarDate(openLabel.date)}`,
              }
            : null
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {canManage ? (
          <nav aria-label="Timesheet views" className="flex gap-1">
            {[
              ['mine', 'My time'],
              ['team', 'Team'],
            ].map(([key, label]) => (
              <Link
                key={key}
                href={href({ view: key })}
                aria-current={view === key ? 'page' : undefined}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground',
                  view === key && 'bg-accent font-medium text-foreground',
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="icon" aria-label="Previous week">
            <Link href={href({ week: addDaysToDate(weekStart, -7) })}>
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
          <p className="min-w-44 text-center text-sm font-medium">
            {formatCalendarDate(weekStart)} – {formatCalendarDate(weekEnd)}
          </p>
          <Button asChild variant="ghost" size="icon" aria-label="Next week">
            <Link href={href({ week: addDaysToDate(weekStart, 7) })}>
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        </div>
      </div>

      {view === 'team' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
          <p className="text-sm">
            <span className="font-medium">{waitingIds.length}</span> waiting ·{' '}
            <span className="font-medium">{formatHours(totalOf(entries, ['approved']))}</span>{' '}
            approved this week
          </p>
          <EntryActions
            ids={waitingIds}
            status="pending"
            canDecide
            canDelete={false}
            label="Approve all waiting"
          />
        </div>
      )}

      {entries.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={Timer}
            title="No time recorded this week"
            description="Time appears here when someone clocks in, or adds it by hand."
          />
        </div>
      ) : (
        [...byPerson.entries()].map(([personId, rows]) => (
          <section key={personId} className="overflow-hidden rounded-xl border bg-card">
            <header className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2.5">
              <h2 className="text-sm font-medium" data-sensitive>
                {view === 'team' ? rows[0]?.personName : 'This week'}
              </h2>
              <p className="text-sm text-muted-foreground">
                {formatHours(totalOf(rows, ['approved']))} approved ·{' '}
                {formatHours(totalOf(rows, ['pending']))} waiting
              </p>
            </header>
            <EntryRows
              entries={rows}
              timezone={timezone}
              today={today}
              userId={ctx.userId}
              canManage={canManage}
              locked={Boolean(ctx.tenant.clockLocation)}
            />
          </section>
        ))
      )}
    </div>
  );
}
