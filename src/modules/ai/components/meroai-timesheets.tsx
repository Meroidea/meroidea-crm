'use client';

import { AlertTriangle, CircleCheck, Clock3, Hand, Timer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';

import { MeroOrb } from '@/components/motion/mero-orb';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCalendarDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { dayParts, formatHours } from '@/modules/roster/hours';
import type { BreakRule } from '@/modules/roster/rules';

import { authoriseTimesheetsAction, prepareTimesheetAuthorisationAction } from '../actions';
import { breaksFor, type AuthoriseRow } from '../timesheet-planner';

type Draft = AuthoriseRow & {
  /** Included in the authorisation; only rows MeroAI marked ready can be. */
  include: boolean;
  /** The manager typed the break, so a change of times no longer recalculates it. */
  breakTyped: boolean;
  edited: boolean;
};

const BASIS: Record<AuthoriseRow['basis'], { label: string; icon: typeof Clock3 }> = {
  clock: { label: 'Clock', icon: Clock3 },
  typed: { label: 'Typed', icon: Hand },
  roster: { label: 'Roster', icon: Timer },
};

const twelve = (time: string) => {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, '0')}${hour < 12 ? 'am' : 'pm'}`;
};

/** The rules in words: "Longer than 5h: 30 min unpaid, 10 min paid". */
function describeRules(rules: BreakRule[]): string[] {
  const byLength = new Map<number, BreakRule[]>();
  for (const rule of rules)
    byLength.set(rule.fromMinutes, [...(byLength.get(rule.fromMinutes) ?? []), rule]);
  return [...byLength.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(
      ([from, items]) =>
        `Longer than ${formatHours(from)}: ${items.map((item) => `${item.minutes} min ${item.paid ? 'paid' : 'unpaid'}`).join(', ')}`,
    );
}

/**
 * "Authorise with MeroAI" on the timesheets pay period (ADR-082). MeroAI prepares every timesheet
 * of the period: clock-in and clock-out where both were recorded, else the rostered times, with
 * breaks by the business's rules. The manager reviews it, changes any times or breaks, and only
 * their "Authorise" approves the rows, each through the ordinary timesheet service.
 */
export function MeroAITimesheets({
  date,
  exportButton,
}: {
  date: string;
  exportButton: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rules, setRules] = useState<BreakRule[] | null>(null);
  const [rows, setRows] = useState<Draft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    approved: number;
    skipped: { key: string; reason: string }[];
  } | null>(null);

  const prepare = () =>
    startTransition(async () => {
      setError(null);
      setResult(null);
      const response = await prepareTimesheetAuthorisationAction({ date });
      if (!response.ok) {
        setError(response.error.message);
        return;
      }
      setRules(response.data.breakRules);
      setRows(
        response.data.rows.map((row) => ({
          ...row,
          include: row.status === 'ready',
          breakTyped: false,
          edited: false,
        })),
      );
    });

  const update = (
    key: string,
    change: Partial<Pick<Draft, 'start' | 'end' | 'unpaidMinutes' | 'include'>>,
  ) =>
    setRows((current) =>
      (current ?? []).map((row) => {
        if (row.key !== key) return row;
        const next: Draft = { ...row, ...change };
        if ('unpaidMinutes' in change) next.breakTyped = true;
        if ('start' in change || 'end' in change || 'unpaidMinutes' in change) next.edited = true;
        if ((change.start || change.end) && next.start && next.end && rules) {
          const breaks = breaksFor(next.start, next.end, rules);
          if (!next.breakTyped) next.unpaidMinutes = breaks.unpaid;
          next.paidBreakMinutes = breaks.paid;
          next.workedMinutes = Math.max(0, breaks.length - next.unpaidMinutes);
        } else if ('unpaidMinutes' in change && next.start && next.end) {
          next.workedMinutes = Math.max(
            0,
            breaksFor(next.start, next.end, []).length - next.unpaidMinutes,
          );
        }
        return next;
      }),
    );

  const chosen = (rows ?? []).filter((row) => row.include && row.status === 'ready');
  const authorise = () =>
    startTransition(async () => {
      setError(null);
      const response = await authoriseTimesheetsAction({
        rows: chosen.map((row) => ({
          key: row.key,
          userId: row.userId,
          shiftId: row.shiftId,
          entryId: row.entryId,
          date: row.date,
          start: row.start,
          end: row.end,
          breakMinutes: row.unpaidMinutes,
        })),
        edited: chosen.filter((row) => row.edited).length,
      });
      if (!response.ok) {
        setError(response.error.message);
        return;
      }
      setResult(response.data);
      const failed = new Set(response.data.skipped.map((item) => item.key));
      setRows((current) =>
        (current ?? []).map((row) =>
          row.include && row.status === 'ready' && !failed.has(row.key)
            ? { ...row, status: 'approved', include: false }
            : row,
        ),
      );
      router.refresh();
    });

  const ready = (rows ?? []).filter((row) => row.status === 'ready');
  const days = [...new Set((rows ?? []).map((row) => row.date))];
  const reasonOf = new Map(result?.skipped.map((item) => [item.key, item.reason]) ?? []);

  return (
    <section className="meroai-edge meroai-surface flex flex-col gap-4 rounded-xl p-5 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        <MeroOrb size={40} state={pending ? 'thinking' : 'idle'} className="-m-0.5" />
        <div className="min-w-0 flex-1">
          <h2 className="font-medium">
            Authorise with <span className="meroai-text">MeroAI</span>
          </h2>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
            MeroAI takes each person’s clock-in and clock-out, or the rostered times when they did
            not clock, adds breaks by your rules, and prepares every timesheet for you to review.
            Nothing is approved until you authorise it.
          </p>
        </div>
        <Button className="meroai-button" onClick={prepare} disabled={pending}>
          {pending && !rows
            ? 'MeroAI is preparing…'
            : rows
              ? 'Prepare again'
              : 'Prepare authorisation'}
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}

      {rows && rules && (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">{ready.length} to authorise</Badge>
            <Badge variant="outline">
              {ready.filter((row) => row.basis === 'clock').length} from the clock
            </Badge>
            <Badge variant="outline">
              {ready.filter((row) => row.basis === 'roster').length} from the roster
            </Badge>
            {rows.some((row) => row.status === 'approved') && (
              <Badge variant="outline">
                {rows.filter((row) => row.status === 'approved').length} already approved
              </Badge>
            )}
            {rows.some((row) => row.status === 'skip') && (
              <Badge variant="outline" className="text-warning-text">
                {rows.filter((row) => row.status === 'skip').length} need you
              </Badge>
            )}
          </div>
          <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Breaks by your rules</p>
            {describeRules(rules).length ? (
              <ul className="mt-0.5">
                {describeRules(rules).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-0.5">No break rules are set, so no breaks are added.</p>
            )}
            <p className="mt-1">Change them under Roster → Actions → Pay loadings and breaks.</p>
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing in this pay period has finished yet, so there is nothing to authorise.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead className="border-b bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="w-8 px-3 py-2">
                      <span className="sr-only">Include</span>
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Person
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Rostered
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Clocked
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Start
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Finish
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Unpaid
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Paid break
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Hours
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Notes
                    </th>
                  </tr>
                </thead>
                {days.map((day) => (
                  <tbody key={day} className="border-b last:border-b-0">
                    <tr className="bg-muted/30">
                      <th colSpan={10} scope="colgroup" className="px-3 py-1.5 text-xs font-medium">
                        {dayParts(day).weekday} {dayParts(day).day}
                      </th>
                    </tr>
                    {rows
                      .filter((row) => row.date === day)
                      .map((row) => {
                        const Basis = BASIS[row.basis].icon;
                        const editable = row.status === 'ready';
                        const reason = reasonOf.get(row.key);
                        return (
                          <tr
                            key={row.key}
                            className={cn(
                              'border-t align-top',
                              row.status !== 'ready' && 'text-muted-foreground',
                            )}
                          >
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                className="mt-1.5 size-4 accent-(--meroai-ink)"
                                aria-label={`Authorise ${row.fullName}, ${formatCalendarDate(row.date)}`}
                                checked={row.include}
                                disabled={!editable || pending}
                                onChange={(event) =>
                                  update(row.key, { include: event.target.checked })
                                }
                              />
                            </td>
                            <td className="px-3 py-2">
                              <p className="font-medium text-foreground">{row.fullName}</p>
                              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Basis aria-hidden className="size-3" /> {BASIS[row.basis].label}
                                {row.team && <span>· {row.team}</span>}
                              </p>
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                              {row.rostered
                                ? `${twelve(row.rostered.start)}–${twelve(row.rostered.end)}`
                                : '—'}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                              {row.recorded
                                ? `${twelve(row.recorded.start)}–${row.recorded.end ? twelve(row.recorded.end) : '…'}`
                                : '—'}
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="time"
                                className="h-8 w-[7.5rem]"
                                aria-label={`Start, ${row.fullName}`}
                                value={row.start}
                                disabled={!editable || pending}
                                onChange={(event) => update(row.key, { start: event.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="time"
                                className="h-8 w-[7.5rem]"
                                aria-label={`Finish, ${row.fullName}`}
                                value={row.end}
                                disabled={!editable || pending}
                                onChange={(event) => update(row.key, { end: event.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  step={5}
                                  className="h-8 w-16"
                                  aria-label={`Unpaid break in minutes, ${row.fullName}`}
                                  value={row.unpaidMinutes}
                                  disabled={!editable || pending}
                                  onChange={(event) =>
                                    update(row.key, {
                                      unpaidMinutes: Math.max(
                                        0,
                                        Math.round(Number(event.target.value) || 0),
                                      ),
                                    })
                                  }
                                />
                                <span className="text-xs text-muted-foreground">min</span>
                              </div>
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                              {row.paidBreakMinutes ? `${row.paidBreakMinutes} min` : '—'}
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-foreground tabular-nums">
                              {formatHours(row.workedMinutes)}
                            </td>
                            <td className="max-w-[16rem] px-3 py-2 text-xs">
                              {row.status === 'approved' && (
                                <p className="flex items-center gap-1 text-foreground">
                                  <CircleCheck aria-hidden className="size-3.5" /> Approved
                                </p>
                              )}
                              {reason && (
                                <p role="alert" className="text-destructive-text">
                                  {reason}
                                </p>
                              )}
                              <ul className="flex flex-col gap-0.5">
                                {row.notes.map((note) => (
                                  <li key={note} className="flex gap-1">
                                    <AlertTriangle
                                      aria-hidden
                                      className="mt-0.5 size-3 shrink-0 opacity-60"
                                    />
                                    {note}
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                ))}
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              className="meroai-button"
              onClick={authorise}
              disabled={pending || chosen.length === 0}
            >
              {pending && rows
                ? 'Authorising…'
                : `Authorise ${chosen.length} timesheet${chosen.length === 1 ? '' : 's'}`}
            </Button>
            <p className="text-sm text-muted-foreground">
              {formatHours(chosen.reduce((sum, row) => sum + row.workedMinutes, 0))} to pay
              {chosen.some((row) => row.edited) &&
                ` · ${chosen.filter((row) => row.edited).length} changed by you`}
            </p>
          </div>

          {result && (
            <div
              role="status"
              className="flex flex-col gap-2 rounded-lg border bg-card px-4 py-3 text-sm"
            >
              <p className="font-medium">
                {result.approved} timesheet{result.approved === 1 ? '' : 's'} authorised for pay.
                {result.skipped.length > 0 &&
                  ` ${result.skipped.length} could not be: see the notes in the table.`}
              </p>
              <p className="text-muted-foreground">
                Export the authorised timesheet when you are ready.
              </p>
              <div className="self-start">{exportButton}</div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
