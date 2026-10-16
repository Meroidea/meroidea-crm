import { ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Timer } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Button } from '@/components/ui/button';
import { addDaysToDate } from '@/lib/dates';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { dayParts, formatHours } from '@/modules/roster/hours';
import { centsToAmount } from '@/modules/roster/rules';
import {
  ApproveAll,
  ExportPeriod,
  TimesheetDay,
} from '@/modules/timesheets/components/timesheet-day';
import type { TimesheetPeriod } from '@/modules/timesheets/period';

export const TIMESHEET_VIEWS = [
  ['mine', 'My time'],
  ['team', 'Team'],
  ['day', 'Approve by day'],
  ['period', 'Pay period'],
] as const;

export function TimesheetViewNav({ view, date }: { view: string; date?: string }) {
  return (
    <nav aria-label="Timesheet views" className="flex flex-wrap gap-1">
      {TIMESHEET_VIEWS.map(([key, label]) => (
        <Link
          key={key}
          href={
            key === 'mine'
              ? '/timesheets'
              : `/timesheets?view=${key}${date && (key === 'day' || key === 'period') ? `&date=${date}` : ''}`
          }
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
  );
}

const SHOW = [
  ['pending', 'To approve'],
  ['approved', 'Approved'],
  ['all', 'All'],
] as const;

/** The manager's screens: each day's rostered shifts against the time recorded, and the period. */
export function ApprovalViews({
  view,
  show,
  period,
  currency,
  today,
}: {
  view: 'day' | 'period';
  show: 'pending' | 'approved' | 'all';
  period: TimesheetPeriod;
  currency: string;
  today: string;
}) {
  const { date } = period;
  const money = (cents: number) => formatMoney(centsToAmount(cents), currency);
  const { weekday, day } = dayParts(date);

  const rows = period.day.filter((row) =>
    show === 'all'
      ? true
      : show === 'approved'
        ? row.entry?.status === 'approved'
        : row.entry?.status !== 'approved',
  );
  const recorded = period.day.flatMap((row) => (row.entry?.endTime ? [row] : []));
  const waitingIds = recorded
    .filter((row) => row.entry?.status === 'pending' && row.canApprove)
    .flatMap((row) => row.entry?.id ?? []);
  const dayCost = recorded.reduce((sum, row) => sum + (row.workedCents ?? 0), 0);
  const totals = [
    [
      'Hours worked',
      formatHours(recorded.reduce((sum, row) => sum + (row.entry?.workedMinutes ?? 0), 0)),
    ],
    [
      'Unpaid breaks',
      formatHours(recorded.reduce((sum, row) => sum + (row.entry?.breakMinutes ?? 0), 0)),
    ],
    ...(period.showCost ? [['Wage cost', money(dayCost)]] : []),
  ] as [string, string][];

  const ready = period.summary.filter((person) => person.ready).length;
  const checks = [
    [period.summary.reduce((sum, person) => sum + person.waiting, 0), 'waiting to be approved'],
    [
      period.summary.reduce((sum, person) => sum + person.missing, 0),
      'rostered with no time recorded',
    ],
    [period.summary.reduce((sum, person) => sum + person.running, 0), 'still clocked in'],
    [
      period.summary.reduce((sum, person) => sum + person.upcoming, 0),
      'rostered shifts still to be worked',
    ],
  ] as [number, string][];
  const problems = checks.filter(([count]) => count > 0);

  return (
    <div className="flex w-full flex-col gap-5">
      <PageHeader
        title="Timesheets"
        description={
          view === 'day'
            ? 'Check what was worked against what was rostered, then approve it for pay.'
            : `Pay period ${formatCalendarDate(period.from)} to ${formatCalendarDate(period.to)}.`
        }
        actions={
          view === 'day' ? (
            !period.locked && <ApproveAll ids={waitingIds} />
          ) : (
            <ExportPeriod
              date={date}
              disabled={period.summary.every((person) => person.approvedMinutes === 0)}
            />
          )
        }
      />
      <TimesheetViewNav view={view} date={date} />
      {period.locked && (
        <p className="rounded-lg border bg-card px-4 py-3 text-sm">
          This pay period has been authorised for pay, so its time can no longer change.
        </p>
      )}

      {view === 'day' ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border bg-card">
              <Button asChild variant="ghost" size="icon" aria-label="Previous day">
                <Link href={`/timesheets?view=day&date=${addDaysToDate(date, -1)}&show=${show}`}>
                  <ChevronLeft aria-hidden />
                </Link>
              </Button>
              <span className="px-2 text-sm font-medium tabular-nums">
                {weekday} {day}
              </span>
              <Button asChild variant="ghost" size="icon" aria-label="Next day">
                <Link href={`/timesheets?view=day&date=${addDaysToDate(date, 1)}&show=${show}`}>
                  <ChevronRight aria-hidden />
                </Link>
              </Button>
            </div>
            <Button asChild variant="outline">
              <Link href={`/timesheets?view=day&date=${today}&show=${show}`}>Today</Link>
            </Button>
            <div
              role="group"
              aria-label="Which rows to show"
              className="ml-auto flex rounded-lg border bg-card p-0.5"
            >
              {SHOW.map(([key, label]) => (
                <Link
                  key={key}
                  href={`/timesheets?view=day&date=${date}&show=${key}`}
                  aria-current={show === key ? 'true' : undefined}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-sm text-muted-foreground hover:text-foreground',
                    show === key && 'bg-accent font-medium text-accent-foreground',
                  )}
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {totals.map(([label, value]) => (
              <div key={label} className="rounded-xl border bg-card px-4 py-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          {rows.length === 0 ? (
            <div className="rounded-xl border bg-card">
              <EmptyState
                icon={Timer}
                title={
                  period.day.length === 0
                    ? 'Nobody was rostered or recorded time this day'
                    : show === 'approved'
                      ? 'Nothing approved yet for this day'
                      : 'Everything for this day is approved'
                }
                description="Rostered shifts appear once the roster is published; time appears when someone clocks in or it is typed in."
              />
            </div>
          ) : (
            <TimesheetDay
              rows={rows}
              date={date}
              currency={currency}
              showCost={period.showCost}
              locked={period.locked}
            />
          )}
        </>
      ) : (
        <>
          <div className="rounded-xl border bg-card px-4 py-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              {problems.length === 0 ? (
                <CircleCheck aria-hidden className="size-4 text-primary" />
              ) : (
                <CircleAlert aria-hidden className="size-4 text-warning-text" />
              )}
              {ready} of {period.summary.length} people ready for pay
            </p>
            {problems.length === 0 ? (
              <p className="mt-1 text-muted-foreground">
                Everything rostered in this period has been worked and approved. Only approved time
                is exported.
              </p>
            ) : (
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {problems.map(([count, label]) => (
                  <li key={label}>
                    {count} {label}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Rostered
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Approved
                  </th>
                  {period.showCost && (
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Gross
                    </th>
                  )}
                  <th scope="col" className="px-4 py-2 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {period.summary.map((person) => {
                  const notes = [
                    person.waiting && `${person.waiting} to approve`,
                    person.missing && `${person.missing} with no time`,
                    person.running && `${person.running} still clocked in`,
                    person.upcoming && `${person.upcoming} still to be worked`,
                  ].filter(Boolean);
                  return (
                    <tr key={person.userId} className="border-b last:border-b-0">
                      <th scope="row" className="px-4 py-2 font-medium" data-sensitive>
                        {person.fullName}
                      </th>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatHours(person.rosteredMinutes)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatHours(person.approvedMinutes)}
                      </td>
                      {period.showCost && (
                        <td className="px-4 py-2 text-right tabular-nums" data-sensitive>
                          {person.costCents === null ? '—' : money(person.costCents)}
                        </td>
                      )}
                      <td className="px-4 py-2">
                        {person.ready ? (
                          <span className="flex items-center gap-1.5">
                            <CircleCheck aria-hidden className="size-4 text-primary" /> Ready
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-warning-text">
                            <CircleAlert aria-hidden className="size-4" /> {notes.join(', ')}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {period.summary.length === 0 && (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Nobody was rostered or recorded time in this period.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Button asChild variant="outline">
              <Link href={`/timesheets?view=period&date=${addDaysToDate(period.from, -1)}`}>
                <ChevronLeft aria-hidden /> Earlier period
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/timesheets?view=period&date=${addDaysToDate(period.to, 1)}`}>
                Later period <ChevronRight aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href={`/timesheets?view=day&date=${period.from}`}>
                Approve this period day by day
              </Link>
            </Button>
          </div>
          {period.showCost && (
            <p className="text-xs text-muted-foreground">
              Gross is worked out from approved time: under an award with written-down rules, by
              those rules and the Fair Work Commission’s rates; otherwise hours at the agreed rate
              with your day loadings. Payslips are still made on the Payroll screen. Check these
              figures before relying on them for pay.
            </p>
          )}
        </>
      )}
    </div>
  );
}
