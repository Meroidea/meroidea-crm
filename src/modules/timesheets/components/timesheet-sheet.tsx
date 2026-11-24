import { BadgeCheck, Timer } from 'lucide-react';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/data/empty-state';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { dayParts, formatHours } from '@/modules/roster/hours';
import type { SheetRow, SheetStatus } from '@/modules/timesheets/sheet-rows';
import type { Timesheet } from '@/modules/timesheets/sheet';
import { EntryActions, EntryButton } from '@/modules/timesheets/components/timesheet-tools';

const STATUS: Record<
  SheetStatus,
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  authorised: { label: 'Authorised', variant: 'default' },
  approved: { label: 'Approved', variant: 'secondary' },
  recorded: { label: 'Waiting', variant: 'outline' },
  clocked_in: { label: 'Clocked in', variant: 'outline' },
  rejected: { label: 'Rejected', variant: 'destructive' },
  no_clock: { label: 'No clock-in', variant: 'destructive' },
  upcoming: { label: 'Upcoming', variant: 'outline' },
  not_paid: { label: 'Not paid', variant: 'outline' },
};

const twelve = (time: string) => {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, '0')}${hour < 12 ? 'am' : 'pm'}`;
};

function Times({ row }: { row: SheetRow }) {
  if (row.status === 'no_clock') {
    return <span className="text-destructive-text">No clock-in</span>;
  }
  if (!row.times) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="tabular-nums">
      {twelve(row.times.start)} – {row.times.end ? twelve(row.times.end) : 'still clocked in'}
    </span>
  );
}

/**
 * The Timesheet view (ADR-083): a section per person (everyone for whoever manages timesheets,
 * otherwise only the signed-in person), with each rostered shift against its clock-in and
 * clock-out, or "No clock-in". Once the pay period is authorised for pay, the times shown are the
 * authorised ones, and a manager can export the whole timesheet from here.
 */
export function TimesheetSheet({
  sheet,
  today,
  viewerId,
  mayApprove,
  staffMayEdit,
  exportButton,
}: {
  sheet: Timesheet;
  today: string;
  viewerId: string;
  /** Whether the viewer may approve this person's time (not their own unless Admin). */
  mayApprove: (userId: string) => boolean;
  /** Staff may correct their own waiting time (not where the workplace location rule applies). */
  staffMayEdit: boolean;
  exportButton: ReactNode;
}) {
  const people = sheet.people.filter((person) => person.rows.length > 0);
  const total = people.reduce((sum, person) => sum + person.approvedMinutes, 0);

  return (
    <div className="flex flex-col gap-4">
      {sheet.locked ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
          <BadgeCheck aria-hidden className="size-5 text-primary" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">Authorised for pay</p>
            <p className="text-muted-foreground">
              {sheet.everyone
                ? `These are the authorised timesheets for this pay period: ${formatHours(total)} in all.`
                : `These are your authorised hours for this pay period: ${formatHours(total)}.`}
            </p>
          </div>
          {sheet.everyone && exportButton}
        </div>
      ) : (
        sheet.everyone &&
        total > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              Not authorised for pay yet. {formatHours(total)} approved so far; times show what was
              clocked until the period is authorised.
            </p>
            {exportButton}
          </div>
        )
      )}

      {people.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={Timer}
            title={sheet.everyone ? 'Nobody was rostered or recorded time' : 'No shifts or time'}
            description="Shifts appear once a roster is published; times appear when someone clocks in or it is added by hand."
          />
        </div>
      ) : (
        people.map((person) => (
          <section key={person.userId} className="overflow-hidden rounded-xl border bg-card">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2.5">
              <h2 className="text-sm font-medium" data-sensitive>
                {sheet.everyone ? person.fullName : 'Your timesheet'}
              </h2>
              <p className="text-sm text-muted-foreground tabular-nums">
                {sheet.locked
                  ? `${formatHours(person.approvedMinutes)} authorised`
                  : `${formatHours(person.approvedMinutes)} approved`}
              </p>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[38rem] text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th scope="col" className="px-4 py-2 font-medium">
                      Day
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Rostered
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      {sheet.locked ? 'Authorised' : 'Clock-in and clock-out'}
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Break
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      Hours
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-2 py-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {person.rows.map((row) => {
                    const { weekday, day } = dayParts(row.date);
                    const status = STATUS[row.status];
                    const finished = Boolean(row.times?.end);
                    const waiting = row.status === 'recorded';
                    const own = row.userId === viewerId;
                    const canEdit =
                      !sheet.locked &&
                      finished &&
                      row.entryId &&
                      (sheet.everyone || (own && waiting && staffMayEdit));
                    return (
                      <tr key={row.key} className="border-b last:border-b-0">
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className="font-medium">{weekday}</span>{' '}
                          <span className="text-muted-foreground">{day}</span>
                          {row.team && (
                            <span className="block text-xs text-muted-foreground">{row.team}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground tabular-nums">
                          {row.rostered
                            ? `${twelve(row.rostered.start)} – ${twelve(row.rostered.end)}`
                            : 'Not rostered'}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <Times row={row} />
                          {row.source === 'roster' && (
                            <span className="block text-xs text-muted-foreground">
                              Paid from the roster
                            </span>
                          )}
                          {row.note && (
                            <span className="block text-xs text-muted-foreground">{row.note}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">
                          {row.times?.breakMinutes ? `${row.times.breakMinutes} min` : '—'}
                        </td>
                        <td
                          className={cn(
                            'px-4 py-2.5 text-right tabular-nums',
                            finished && 'font-medium',
                          )}
                        >
                          {finished && row.times ? formatHours(row.times.workedMinutes) : '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </td>
                        <td className="px-2 py-2.5">
                          {row.entryId && row.times?.end && !sheet.locked && (
                            <div className="flex items-center justify-end">
                              {canEdit && (
                                <EntryButton
                                  today={today}
                                  entry={{
                                    id: row.entryId,
                                    date: row.date,
                                    start: row.times.start,
                                    end: row.times.end,
                                    breakMinutes: String(row.times.breakMinutes),
                                    note: row.note ?? '',
                                  }}
                                />
                              )}
                              <EntryActions
                                ids={[row.entryId]}
                                status={
                                  row.status === 'approved'
                                    ? 'approved'
                                    : row.status === 'rejected'
                                      ? 'rejected'
                                      : 'pending'
                                }
                                canDecide={sheet.everyone && mayApprove(row.userId)}
                                canDelete={Boolean(
                                  sheet.everyone || (own && waiting && staffMayEdit),
                                )}
                              />
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
