'use client';

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  MoreHorizontal,
  Plus,
  Send,
  Undo2,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition, type CSSProperties } from 'react';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { addDaysToDate, daysBetweenDates } from '@/lib/dates';
import { cn } from '@/lib/utils';
import {
  deleteRosterAction,
  publishRosterAction,
  unpublishRosterAction,
} from '@/modules/roster/actions';
import { ShiftSheet, type ShiftDraft } from '@/modules/roster/components/shift-sheet';
import { dayParts, formatHours, positionCode, positionTone } from '@/modules/roster/hours';
import type { RosterPerson, RosterShift, RosterSummary } from '@/modules/roster/types';

/** Name column, then seven day columns that never get too narrow to read. */
const GRID =
  'grid grid-cols-[7.5rem_repeat(7,minmax(7.75rem,1fr))] sm:grid-cols-[11rem_repeat(7,minmax(8rem,1fr))]';

function ShiftChip({
  shift,
  onOpen,
}: {
  shift: RosterShift;
  /** Present only for someone who can manage the roster. */
  onOpen?: () => void;
}) {
  const code = positionCode(shift.position);
  const tone = { '--tone': `var(--${positionTone(shift.position)})` } as CSSProperties;
  const body = (
    <>
      <span
        aria-hidden
        className="flex w-8 shrink-0 items-center justify-center rounded-l-[7px] bg-[color-mix(in_srgb,var(--tone)_30%,var(--card))] text-[11px] font-semibold text-foreground"
      >
        {code || <Clock className="size-3.5" />}
      </span>
      <span className="min-w-0 flex-1 px-2 py-1.5 text-left">
        <span className="block text-xs font-medium tabular-nums">
          {shift.startTime} – {shift.endTime}
          {shift.overnight && <span className="text-muted-foreground"> +1</span>}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {formatHours(shift.paidMinutes)}
          {shift.position ? ` · ${shift.position}` : ''}
        </span>
      </span>
    </>
  );
  const className =
    'flex w-full items-stretch overflow-hidden rounded-lg border border-[color-mix(in_srgb,var(--tone)_45%,var(--border))] bg-[color-mix(in_srgb,var(--tone)_7%,var(--card))]';
  const label = `${shift.startTime} to ${shift.endTime}${shift.position ? `, ${shift.position}` : ''}`;

  return onOpen ? (
    <button
      type="button"
      style={tone}
      onClick={onOpen}
      aria-label={`Edit shift, ${label}`}
      title={shift.note ?? undefined}
      className={cn(
        className,
        'transition-shadow outline-none hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50',
      )}
    >
      {body}
    </button>
  ) : (
    <div style={tone} className={className} title={shift.note ?? undefined}>
      {body}
    </div>
  );
}

export function RosterBoard({
  roster,
  shifts,
  people,
  canManage,
  today,
}: {
  roster: RosterSummary;
  shifts: RosterShift[];
  people: RosterPerson[];
  canManage: boolean;
  /** Today's calendar date in the workspace timezone. */
  today: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<ShiftDraft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dayCount = daysBetweenDates(roster.startsOn, roster.endsOn) + 1;
  const days = useMemo(
    () =>
      Array.from({ length: dayCount }, (_, index) => {
        const date = addDaysToDate(roster.startsOn, index);
        return { date, ...dayParts(date) };
      }),
    [roster.startsOn, dayCount],
  );
  const weeks = [days.slice(0, 7), days.slice(7)].filter((week) => week.length > 0);

  // Anyone with a shift keeps a row even if they have since left the active member list.
  const rows = useMemo(() => {
    const known = new Set(people.map((person) => person.userId));
    const former = [...new Set(shifts.map((shift) => shift.userId))]
      .filter((userId) => !known.has(userId))
      .map((userId) => ({ userId, fullName: 'Former member' }));
    return [...people, ...former];
  }, [people, shifts]);

  const byCell = useMemo(() => {
    const map = new Map<string, RosterShift[]>();
    for (const shift of shifts) {
      const key = `${shift.userId}|${shift.date}`;
      map.set(key, [...(map.get(key) ?? []), shift]);
    }
    return map;
  }, [shifts]);

  const minutesBy = (pick: (shift: RosterShift) => string) => {
    const totals = new Map<string, number>();
    for (const shift of shifts) {
      totals.set(pick(shift), (totals.get(pick(shift)) ?? 0) + shift.paidMinutes);
    }
    return totals;
  };
  const personMinutes = minutesBy((shift) => shift.userId);
  const dayMinutes = minutesBy((shift) => shift.date);
  const totalMinutes = shifts.reduce((sum, shift) => sum + shift.paidMinutes, 0);
  const positions = [...new Set(shifts.flatMap((shift) => shift.position ?? []))].sort();
  const published = roster.status === 'published';

  const run = (action: () => Promise<{ ok: boolean; error?: { message: string } }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) setError(result.error?.message ?? 'Something went wrong.');
      else router.refresh();
    });

  const first = days[0];
  const last = days[days.length - 1];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border bg-card">
          <Button asChild variant="ghost" size="icon" aria-label="Previous period">
            <Link href={`/roster?date=${addDaysToDate(roster.startsOn, -1)}`}>
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
          <span className="px-2 text-sm font-medium tabular-nums">
            {first?.day} – {last?.day}
          </span>
          <Button asChild variant="ghost" size="icon" aria-label="Next period">
            <Link href={`/roster?date=${addDaysToDate(roster.endsOn, 1)}`}>
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        </div>
        <Button asChild variant="outline">
          <Link href="/roster">Today</Link>
        </Button>
        <Badge variant="outline">{dayCount === 14 ? 'Fortnightly' : 'Weekly'}</Badge>
        <Badge
          variant={published ? 'default' : 'secondary'}
          className={cn(!published && 'border-warning-border bg-warning text-warning-text')}
        >
          {published ? 'Published' : 'Draft'}
        </Badge>

        {canManage && (
          <div className="ml-auto flex items-center gap-2">
            {published ? (
              <Button
                variant="outline"
                disabled={isPending}
                onClick={() => run(() => unpublishRosterAction({ id: roster.id }))}
              >
                <Undo2 aria-hidden /> Back to draft
              </Button>
            ) : (
              <Button
                disabled={isPending}
                onClick={() => run(() => publishRosterAction({ id: roster.id }))}
              >
                <Send aria-hidden /> Publish
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More roster actions">
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                  Delete roster
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {canManage && !published && (
        <p className="rounded-lg border border-warning-border bg-warning px-3 py-2 text-sm text-warning-text">
          This roster is a draft. Only people who manage rosters can see it until you publish it.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}

      <dl className="grid grid-cols-3 gap-3">
        {[
          { icon: Clock, label: 'Total hours', value: formatHours(totalMinutes) },
          { icon: CalendarDays, label: 'Shifts', value: String(shifts.length) },
          { icon: Users, label: 'People rostered', value: String(personMinutes.size) },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-xl border bg-card px-4 py-3">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon aria-hidden className="size-3.5" /> {label}
            </dt>
            <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {weeks.map((week, weekIndex) => (
        <section
          key={week[0]?.date}
          aria-label={weeks.length > 1 ? `Week ${weekIndex + 1}` : 'Roster'}
          className="overflow-x-auto rounded-xl border bg-card"
        >
          <div role="table" className="min-w-max">
            <div role="row" className={cn(GRID, 'border-b bg-muted/60 text-xs')}>
              <div
                role="columnheader"
                className="sticky left-0 z-10 flex items-end bg-muted px-3 py-2 font-medium text-muted-foreground"
              >
                {weeks.length > 1 ? `Week ${weekIndex + 1}` : 'Team'}
              </div>
              {week.map((day) => (
                <div
                  key={day.date}
                  role="columnheader"
                  className={cn('border-l px-2.5 py-2', day.date === today && 'bg-accent')}
                >
                  <span
                    className={cn(
                      'block font-medium text-foreground',
                      day.date === today && 'text-primary',
                    )}
                  >
                    {day.weekday} {day.day}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatHours(dayMinutes.get(day.date) ?? 0)}
                  </span>
                </div>
              ))}
            </div>

            {rows.map((person) => (
              <div key={person.userId} role="row" className={cn(GRID, 'border-b last:border-b-0')}>
                <div
                  role="rowheader"
                  className="sticky left-0 z-10 flex flex-col justify-center bg-card px-3 py-2"
                >
                  <span className="truncate text-sm font-medium" data-sensitive>
                    {person.fullName}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatHours(personMinutes.get(person.userId) ?? 0)}
                  </span>
                </div>
                {week.map((day) => {
                  const cell = byCell.get(`${person.userId}|${day.date}`) ?? [];
                  return (
                    <div
                      key={day.date}
                      role="cell"
                      className={cn(
                        'group/cell flex min-h-16 flex-col gap-1.5 border-l p-1.5',
                        day.date === today && 'bg-accent/40',
                      )}
                    >
                      {cell.map((shift) => (
                        <ShiftChip
                          key={shift.id}
                          shift={shift}
                          onOpen={
                            canManage
                              ? () => setDraft({ userId: person.userId, date: day.date, shift })
                              : undefined
                          }
                        />
                      ))}
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => setDraft({ userId: person.userId, date: day.date })}
                          aria-label={`Add shift for ${person.fullName} on ${day.weekday} ${day.day}`}
                          className={cn(
                            'flex flex-1 items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground transition-opacity outline-none hover:border-primary hover:text-primary focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                            cell.length > 0
                              ? 'min-h-6 opacity-0 group-hover/cell:opacity-100'
                              : 'min-h-12 opacity-60 hover:opacity-100 sm:opacity-0 sm:group-hover/cell:opacity-100',
                          )}
                        >
                          <Plus aria-hidden className="size-3.5" /> Add shift
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      ))}

      {draft && (
        <ShiftSheet
          key={`${draft.userId}|${draft.date}|${draft.shift?.id ?? 'new'}`}
          rosterId={roster.id}
          draft={draft}
          people={rows.filter((person) => people.some((active) => active.userId === person.userId))}
          days={days.map((day) => ({ date: day.date, label: `${day.weekday} ${day.day}` }))}
          positions={positions}
          onClose={() => setDraft(null)}
        />
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this roster?</AlertDialogTitle>
            <AlertDialogDescription>
              The roster and its {shifts.length} {shifts.length === 1 ? 'shift' : 'shifts'} will be
              removed for everyone. You can create a new roster for the same days afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep roster</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                setConfirmDelete(false);
                run(() => deleteRosterAction({ id: roster.id }));
              }}
            >
              Delete roster
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
