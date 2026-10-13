'use client';

import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  MoreHorizontal,
  Plus,
  Send,
  UserRoundPlus,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { addDaysToDate, daysBetweenDates } from '@/lib/dates';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { deleteRosterAction, unpublishRosterAction } from '@/modules/roster/actions';
import { PublishSheet } from '@/modules/roster/components/publish-sheet';
import { RulesSheet } from '@/modules/roster/components/rules-sheet';
import { ShiftCard } from '@/modules/roster/components/shift-card';
import { ShiftEditor, type ShiftDraft } from '@/modules/roster/components/shift-editor';
import { TeamsSheet } from '@/modules/roster/components/teams-sheet';
import { dayParts, formatHours } from '@/modules/roster/hours';
import { costOfShift, leaveOn, shiftWarnings } from '@/modules/roster/insights';
import { centsToAmount } from '@/modules/roster/rules';
import type {
  RemovedShift,
  RosterLeave,
  RosterPerson,
  RosterRates,
  RosterRules,
  RosterShift,
  RosterSummary,
  RosterTeam,
} from '@/modules/roster/types';

type View = 'day' | 'person';
type Panel = 'publish' | 'teams' | 'rules' | 'delete' | null;

/** Name column, then seven day columns that never get too narrow to read. */
const PERSON_GRID =
  'grid grid-cols-[7.5rem_repeat(7,minmax(8.75rem,1fr))] sm:grid-cols-[11rem_repeat(7,minmax(9rem,1fr))]';
const DAY_GRID = 'grid grid-cols-[repeat(7,minmax(9.5rem,1fr))]';
const VACANT = 'vacant';

function AddShiftButton({
  label,
  quiet,
  onClick,
}: {
  label: string;
  /** Hidden until the cell is hovered or focused, where a shift is already showing. */
  quiet: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'flex items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground transition-opacity outline-none hover:border-primary hover:text-primary focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50',
        quiet
          ? 'min-h-6 opacity-0 group-hover/cell:opacity-100'
          : 'min-h-10 opacity-70 hover:opacity-100',
      )}
    >
      <Plus aria-hidden className="size-3.5" /> Add shift
    </button>
  );
}

export function RosterBoard({
  roster,
  shifts,
  removed,
  people,
  teams,
  leave,
  rules,
  rates,
  currency,
  canManage,
  wholeRoster,
  today,
}: {
  roster: RosterSummary;
  shifts: RosterShift[];
  /** Published shifts removed since the last publish. Empty unless the person can manage. */
  removed: RemovedShift[];
  people: RosterPerson[];
  teams: RosterTeam[];
  leave: RosterLeave[];
  rules: RosterRules;
  /** Null when the person may not see pay; no cost is shown then. */
  rates: RosterRates | null;
  currency: string;
  canManage: boolean;
  /** False for general staff, who see a roster of one: themselves. */
  wholeRoster: boolean;
  /** Today's calendar date in the workspace timezone. */
  today: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>(wholeRoster ? 'day' : 'person');
  const [teamFilter, setTeamFilter] = useState('');
  const [draft, setDraft] = useState<ShiftDraft | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
  const teamOf = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const holidayOf = useMemo(
    () => new Map(rules.holidays.map((holiday) => [holiday.day, holiday.name])),
    [rules.holidays],
  );

  // Anyone with a shift keeps a row even if they have since left the active member list.
  const rows = useMemo(() => {
    const known = new Set(people.map((person) => person.userId));
    const former = [...new Set(shifts.flatMap((shift) => shift.userId ?? []))]
      .filter((userId) => !known.has(userId))
      .map((userId) => ({ userId, fullName: 'Former member' }));
    return [...people, ...former];
  }, [people, shifts]);
  const nameOf = useMemo(() => new Map(rows.map((row) => [row.userId, row.fullName])), [rows]);

  const visible = useMemo(
    () =>
      teamFilter
        ? shifts.filter((shift) =>
            teamFilter === 'none' ? !teamOf.has(shift.teamId ?? '') : shift.teamId === teamFilter,
          )
        : shifts,
    [shifts, teamFilter, teamOf],
  );

  const figures = useMemo(() => {
    const holidays = new Set(holidayOf.keys());
    const cents = new Map<string, number | null>();
    const minutes = { day: new Map<string, number>(), person: new Map<string, number>() };
    const money = { day: new Map<string, number>(), person: new Map<string, number>() };
    const add = (map: Map<string, number>, key: string, value: number) =>
      map.set(key, (map.get(key) ?? 0) + value);
    let totalMinutes = 0;
    let totalCents = 0;
    for (const shift of visible) {
      const who = shift.userId ?? VACANT;
      totalMinutes += shift.paidMinutes;
      add(minutes.day, shift.date, shift.paidMinutes);
      add(minutes.person, who, shift.paidMinutes);
      if (!rates) continue;
      const cost = costOfShift(shift, rates, rules, holidays).cents;
      cents.set(shift.id, cost);
      if (cost === null) continue;
      totalCents += cost;
      add(money.day, shift.date, cost);
      add(money.person, who, cost);
    }
    return { cents, minutes, money, totalMinutes, totalCents };
  }, [visible, rates, rules, holidayOf]);

  const warningsOf = (shift: RosterShift) =>
    canManage ? shiftWarnings(shift, { leave, today, rates }).length : 0;
  const money = (cents: number) => formatMoney(centsToAmount(cents), currency);

  const published = roster.status === 'published';
  const pendingCount = shifts.filter((shift) => shift.unpublishedChanges).length + removed.length;
  const vacantCount = visible.filter((shift) => shift.userId === null).length;
  const first = days[0];
  const last = days[days.length - 1];

  const run = (action: () => Promise<{ ok: boolean; error?: { message: string } }>) =>
    startTransition(async () => {
      setError(null);
      setNotice(null);
      const result = await action();
      if (!result.ok) setError(result.error?.message ?? 'Something went wrong.');
      else router.refresh();
    });

  const byStart = (a: RosterShift, b: RosterShift) =>
    a.startTime.localeCompare(b.startTime) ||
    (nameOf.get(a.userId ?? '') ?? '').localeCompare(nameOf.get(b.userId ?? '') ?? '');

  const card = (shift: RosterShift, title: string) => (
    <ShiftCard
      key={shift.id}
      shift={shift}
      team={teamOf.get(shift.teamId ?? '')}
      title={title}
      warnings={warningsOf(shift)}
      onOpen={
        canManage ? () => setDraft({ userId: shift.userId, date: shift.date, shift }) : undefined
      }
    />
  );

  const stats = [
    { icon: Clock, label: 'Total hours', value: formatHours(figures.totalMinutes) },
    ...(rates ? [{ icon: Wallet, label: 'Wage cost', value: money(figures.totalCents) }] : []),
    { icon: CalendarDays, label: 'Shifts', value: String(visible.length) },
    ...(wholeRoster
      ? [{ icon: UserRoundPlus, label: 'Vacant shifts', value: String(vacantCount) }]
      : []),
  ];

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

        {wholeRoster && (
          <div
            role="group"
            aria-label="Roster layout"
            className="flex rounded-lg border bg-card p-0.5"
          >
            {(
              [
                ['day', 'By day'],
                ['person', 'By person'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                onClick={() => setView(key)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  view === key && 'bg-accent font-medium text-accent-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {teams.length > 0 && (
          <NativeSelect
            aria-label="Show team"
            className="w-auto"
            value={teamFilter}
            onChange={(event) => setTeamFilter(event.target.value)}
          >
            <option value="">All teams</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
            <option value="none">No team</option>
          </NativeSelect>
        )}
        <Badge variant="outline">{dayCount === 14 ? 'Fortnightly' : 'Weekly'}</Badge>
        {!canManage && (
          <Badge variant={published ? 'default' : 'secondary'}>
            {published ? 'Published' : 'Draft'}
          </Badge>
        )}

        {canManage && (
          <div className="ml-auto flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <MoreHorizontal aria-hidden /> Actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setPanel('teams')}>Teams</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPanel('rules')}>
                  Pay loadings and breaks
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {published && (
                  <DropdownMenuItem
                    disabled={isPending}
                    onSelect={() => run(() => unpublishRosterAction({ id: roster.id }))}
                  >
                    Back to draft
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem variant="destructive" onSelect={() => setPanel('delete')}>
                  Delete roster
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {published && pendingCount === 0 ? (
              <Button variant="outline" onClick={() => setPanel('publish')}>
                <Check aria-hidden /> All published
              </Button>
            ) : (
              <Button onClick={() => setPanel('publish')}>
                <Send aria-hidden /> Review and publish
                {pendingCount > 0 && (
                  <span className="rounded-full bg-primary-foreground/20 px-1.5 text-xs tabular-nums">
                    {pendingCount}
                  </span>
                )}
              </Button>
            )}
          </div>
        )}
      </div>

      {canManage && !published && (
        <p className="rounded-lg border border-warning-border bg-warning px-3 py-2 text-sm text-warning-text">
          This roster is a draft. Only people who manage rosters can see it until you publish it.
        </p>
      )}
      {canManage && published && pendingCount > 0 && (
        <p className="rounded-lg border border-warning-border bg-warning px-3 py-2 text-sm text-warning-text">
          {pendingCount} {pendingCount === 1 ? 'change has' : 'changes have'} not been published.
          New shifts stay hidden from staff until you publish them.
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border bg-card px-3 py-2 text-sm">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-xl border bg-card px-4 py-3">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon aria-hidden className="size-3.5" /> {label}
            </dt>
            <dd
              className="mt-1 text-xl font-semibold tracking-tight tabular-nums"
              data-sensitive={label === 'Wage cost' ? true : undefined}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {weeks.map((week, weekIndex) => {
        const header = (lead: boolean) => (
          <div
            role="row"
            className={cn(view === 'day' ? DAY_GRID : PERSON_GRID, 'border-b bg-muted/60 text-xs')}
          >
            {lead && (
              <div
                role="columnheader"
                className="sticky left-0 z-10 flex items-end bg-muted px-3 py-2 font-medium text-muted-foreground"
              >
                {weeks.length > 1 ? `Week ${weekIndex + 1}` : 'Team'}
              </div>
            )}
            {week.map((day, index) => (
              <div
                key={day.date}
                role="columnheader"
                className={cn(
                  'px-2.5 py-2',
                  (lead || index > 0) && 'border-l',
                  day.date === today && 'bg-accent',
                )}
              >
                <span
                  className={cn(
                    'block font-medium text-foreground',
                    day.date === today && 'text-primary',
                  )}
                >
                  {day.weekday} {day.day}
                </span>
                <span className="block text-muted-foreground tabular-nums">
                  {formatHours(figures.minutes.day.get(day.date) ?? 0)}
                  {rates && (
                    <span data-sensitive> · {money(figures.money.day.get(day.date) ?? 0)}</span>
                  )}
                </span>
                {holidayOf.has(day.date) && (
                  <span className="mt-0.5 block truncate text-warning-text">
                    {holidayOf.get(day.date)}
                  </span>
                )}
              </div>
            ))}
          </div>
        );

        return (
          <section
            key={week[0]?.date}
            aria-label={weeks.length > 1 ? `Week ${weekIndex + 1}` : 'Roster'}
            className="overflow-x-auto rounded-xl border bg-card"
          >
            {view === 'day' ? (
              <div role="table" className="min-w-max">
                {header(false)}
                <div role="row" className={DAY_GRID}>
                  {week.map((day, index) => {
                    const cell = visible.filter((shift) => shift.date === day.date).sort(byStart);
                    return (
                      <div
                        key={day.date}
                        role="cell"
                        className={cn(
                          'group/cell flex min-h-40 flex-col gap-1.5 p-1.5',
                          index > 0 && 'border-l',
                          day.date === today && 'bg-accent/40',
                        )}
                      >
                        {cell.map((shift) =>
                          card(
                            shift,
                            shift.userId ? (nameOf.get(shift.userId) ?? 'Former member') : 'Vacant',
                          ),
                        )}
                        {canManage && (
                          <AddShiftButton
                            quiet={false}
                            label={`Add shift on ${day.weekday} ${day.day}`}
                            onClick={() => setDraft({ userId: null, date: day.date })}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div role="table" className="min-w-max">
                {header(true)}
                {[
                  ...(wholeRoster && (canManage || vacantCount > 0)
                    ? [{ userId: VACANT, fullName: 'Vacant' }]
                    : []),
                  ...rows,
                ].map((person) => {
                  const personId = person.userId === VACANT ? null : person.userId;
                  return (
                    <div
                      key={person.userId}
                      role="row"
                      className={cn(PERSON_GRID, 'border-b last:border-b-0')}
                    >
                      <div
                        role="rowheader"
                        className="sticky left-0 z-10 flex flex-col justify-center bg-card px-3 py-2"
                      >
                        <span
                          className={cn(
                            'truncate text-sm font-medium',
                            personId === null && 'text-muted-foreground',
                          )}
                          data-sensitive={personId === null ? undefined : true}
                        >
                          {person.fullName}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {formatHours(figures.minutes.person.get(person.userId) ?? 0)}
                          {rates && personId !== null && (
                            <span data-sensitive>
                              {' '}
                              · {money(figures.money.person.get(person.userId) ?? 0)}
                            </span>
                          )}
                        </span>
                      </div>
                      {week.map((day) => {
                        const cell = visible
                          .filter((shift) => shift.userId === personId && shift.date === day.date)
                          .sort(byStart);
                        const away = leaveOn(leave, personId, day.date);
                        return (
                          <div
                            key={day.date}
                            role="cell"
                            className={cn(
                              'group/cell flex min-h-16 flex-col gap-1.5 border-l p-1.5',
                              day.date === today && 'bg-accent/40',
                            )}
                          >
                            {away && (
                              <p className="rounded-md border border-warning-border bg-warning px-2 py-1 text-[11px] text-warning-text">
                                {away.status === 'approved' ? 'On leave' : 'Leave requested'}
                                <span className="block truncate opacity-80">{away.typeName}</span>
                              </p>
                            )}
                            {cell.map((shift) =>
                              card(shift, teamOf.get(shift.teamId ?? '')?.name ?? 'No team'),
                            )}
                            {canManage && (
                              <AddShiftButton
                                quiet={cell.length > 0 || Boolean(away)}
                                label={`Add shift for ${person.fullName} on ${day.weekday} ${day.day}`}
                                onClick={() => setDraft({ userId: personId, date: day.date })}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {draft && (
        <ShiftEditor
          key={`${draft.userId}|${draft.date}|${draft.shift?.id ?? 'new'}`}
          rosterId={roster.id}
          draft={draft}
          people={people}
          teams={teams}
          days={days.map((day) => ({ date: day.date, label: `${day.weekday} ${day.day}` }))}
          shifts={shifts}
          leave={leave}
          rules={rules}
          rates={rates}
          currency={currency}
          today={today}
          onClose={() => setDraft(null)}
        />
      )}
      {panel === 'publish' && (
        <PublishSheet
          rosterId={roster.id}
          period={`${first?.day} to ${last?.day}`}
          shifts={shifts}
          removed={removed}
          people={rows}
          onClose={() => setPanel(null)}
          onPublished={setNotice}
        />
      )}
      {panel === 'teams' && (
        <TeamsSheet teams={teams} people={people} onClose={() => setPanel(null)} />
      )}
      {panel === 'rules' && <RulesSheet rules={rules} onClose={() => setPanel(null)} />}

      <AlertDialog open={panel === 'delete'} onOpenChange={(open) => !open && setPanel(null)}>
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
                setPanel(null);
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
