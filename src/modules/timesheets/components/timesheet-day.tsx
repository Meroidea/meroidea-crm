'use client';

import { Check, CircleCheck, Download, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type CSSProperties } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { formatHours, teamCode } from '@/modules/roster/hours';
import { centsToAmount, shiftLength } from '@/modules/roster/rules';
import {
  decideEntriesAction,
  deleteEntryAction,
  exportTimesheetsAction,
  exportTimesheetWorkbookAction,
  saveDayEntryAction,
} from '@/modules/timesheets/actions';
import type { DayRowView } from '@/modules/timesheets/period';

type Result = { ok: boolean; error?: { message: string; fieldErrors?: Record<string, string[]> } };

function useRun() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const run = (action: () => Promise<Result>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) {
        setError(
          Object.values(result.error?.fieldErrors ?? {})[0]?.[0] ??
            result.error?.message ??
            'Something went wrong.',
        );
        return;
      }
      router.refresh();
    });
  return { run, error, isPending };
}

const money = (cents: number, currency: string) => formatMoney(centsToAmount(cents), currency);

/** One rostered shift or stretch of recorded time: type what was worked, then approve it. */
function DayRow({
  row,
  date,
  currency,
  showCost,
  locked,
}: {
  row: DayRowView;
  date: string;
  currency: string;
  showCost: boolean;
  locked: boolean;
}) {
  const { shift, entry } = row;
  const { run, error, isPending } = useRun();
  const [start, setStart] = useState(entry?.startTime ?? '');
  const [end, setEnd] = useState(entry?.endTime ?? '');
  const [breakMinutes, setBreakMinutes] = useState(entry ? String(entry.breakMinutes) : '');

  const running = Boolean(entry && !entry.endTime);
  const approved = entry?.status === 'approved';
  const rejected = entry?.status === 'rejected';
  const fixed = locked || approved || running;
  const complete = /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end);
  const dirty =
    !entry ||
    start !== entry.startTime ||
    end !== (entry.endTime ?? '') ||
    Number(breakMinutes || 0) !== entry.breakMinutes;
  const typedMinutes = complete ? shiftLength(start, end) - Number(breakMinutes || 0) : null;

  const save = (approve: boolean) =>
    run(() =>
      !dirty && entry
        ? decideEntriesAction({ ids: [entry.id], decision: approve ? 'approved' : 'pending' })
        : saveDayEntryAction({
            ...(entry ? { entryId: entry.id } : {}),
            ...(shift ? { shiftId: shift.id } : {}),
            userId: row.userId,
            date,
            start,
            end,
            breakMinutes: breakMinutes || 0,
            approve,
          }),
    );
  const useRostered = () => {
    if (!shift) return;
    setStart(shift.startTime);
    setEnd(shift.endTime);
    setBreakMinutes(String(shift.breakMinutes));
  };

  const workedMinutes = entry?.endTime ? entry.workedMinutes : null;
  const overMinutes = shift && workedMinutes !== null ? workedMinutes - shift.paidMinutes : null;
  const overCents =
    row.workedCents !== null && row.rosteredCents !== null
      ? row.workedCents - row.rosteredCents
      : null;
  const tone = { '--tone': `var(--${row.team?.color ?? 'chart-3'})` } as CSSProperties;
  const field = (
    value: string,
    set: (next: string) => void,
    label: string,
    hint: string | null,
  ) => (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span className="sr-only">{label}</span>
      <Input
        type="time"
        value={value}
        disabled={fixed || isPending}
        onChange={(event) => set(event.target.value)}
        aria-label={`${label} for ${row.fullName}`}
        aria-invalid={!value && !fixed}
        className="w-32 text-center text-base tabular-nums"
      />
      <span className="tabular-nums">{hint ? `R ${hint}` : 'Not rostered'}</span>
    </label>
  );

  // The shift as it will be paid: typed or recorded times, else the roster's.
  const barStart = complete ? start : (shift?.startTime ?? null);
  const barEnd = complete ? end : (shift?.endTime ?? null);
  const unpaid = Number(breakMinutes || 0) || (!entry ? (shift?.breakMinutes ?? 0) : 0);
  const length = barStart && barEnd ? shiftLength(barStart, barEnd) : 0;
  // The break drawn on the hour before the middle, as the timesheet export places it.
  const breakAt = length ? Math.floor(length / 2 / 60) * 60 : 0;
  const allowances = row.lines.filter((line) => line.minutes === null);
  const paidMinutes =
    workedMinutes ?? (typedMinutes !== null && typedMinutes > 0 ? typedMinutes : null);
  const hm = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

  return (
    <li className="grid border-b last:border-b-0 lg:grid-cols-[15rem_1fr_16rem_2.75rem]">
      <div className="flex min-w-0 items-start gap-3 p-4 lg:border-r">
        <span
          aria-hidden
          style={tone}
          className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--tone)_22%,var(--card))] text-sm font-semibold"
        >
          {teamCode(row.team?.name) || '·'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold" data-sensitive>
            {row.fullName}
          </p>
          <p
            style={tone}
            className="mt-1.5 truncate rounded-md border border-l-4 border-l-(--tone) bg-card px-2 py-1 text-xs"
          >
            {row.team?.name ?? (shift ? 'No team' : 'Not rostered this day')}
          </p>
          {entry && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {running
                ? 'Still clocked in'
                : entry.source === 'clock'
                  ? 'Clocked in and out'
                  : entry.source === 'roster'
                    ? 'Paid from the roster'
                    : 'Typed in'}
            </p>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col">
        <div className="flex flex-col gap-3 p-4">
          <div
            style={tone}
            className={cn(
              'flex h-1.5 overflow-hidden rounded-full bg-muted',
              !entry && 'opacity-50',
            )}
            aria-hidden
          >
            {length > 0 &&
              (unpaid > 0 && unpaid < length ? (
                <>
                  <span className="bg-(--tone)" style={{ width: `${(breakAt / length) * 100}%` }} />
                  <span className="bg-muted" style={{ width: `${(unpaid / length) * 100}%` }} />
                  <span className="flex-1 bg-(--tone)" />
                </>
              ) : (
                <span className="flex-1 bg-(--tone)" />
              ))}
          </div>
          <div className="flex flex-wrap items-start gap-3">
            {field(start, setStart, 'Start', shift?.startTime ?? null)}
            {field(end, setEnd, 'Finish', shift?.endTime ?? null)}
            {shift && !entry && !locked && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1"
                onClick={useRostered}
              >
                As rostered
              </Button>
            )}
            <label className="ml-auto flex flex-col items-end gap-1 text-xs text-muted-foreground">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                step={5}
                value={breakMinutes}
                placeholder="0"
                disabled={fixed || isPending}
                onChange={(event) => setBreakMinutes(event.target.value)}
                aria-label={`Unpaid break in minutes for ${row.fullName}`}
                className="w-24 text-center tabular-nums"
              />
              <span>
                {Number(breakMinutes || 0) > 0 ? `${breakMinutes} min unpaid break` : 'No break'}
                {shift ? ` · R ${shift.breakMinutes}m` : ''}
              </span>
            </label>
          </div>
          {row.warnings.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-warning-text">
              {row.warnings.map((warning) => (
                <li
                  key={`${warning.clause}|${warning.message}`}
                  className="flex items-start gap-1.5"
                >
                  <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {warning.message} (cl {warning.clause})
                  </span>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 text-xs">
          <span className="text-muted-foreground">Allowances</span>
          {allowances.length ? (
            allowances.map((line) => {
              const each = Math.round(Number(line.rate) * 100);
              return (
                <span key={`${line.kind}|${line.label}`}>
                  {line.label} ({each > 0 ? Math.max(1, Math.round(line.cents / each)) : 1})
                </span>
              );
            })
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
          {row.lines.length > 0 && (
            <details className="ml-auto">
              <summary className="cursor-pointer text-muted-foreground">
                Pay lines ({row.lines.length})
              </summary>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                {row.lines.map((line) => (
                  <div key={`${line.kind}|${line.label}`} className="contents">
                    <dt className="text-muted-foreground">
                      {line.label} ·{' '}
                      {line.minutes === null
                        ? `${formatMoney(line.rate, currency)} each`
                        : `${formatHours(line.minutes)} at ${formatMoney(line.rate, currency)}`}{' '}
                      · cl {line.clause}
                    </dt>
                    <dd className="text-right tabular-nums" data-sensitive>
                      {money(line.cents, currency)}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t p-4 lg:border-t-0 lg:border-l">
        <dl className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 text-sm tabular-nums">
          <dt className="font-medium">Wage cost</dt>
          <dd className="text-right font-semibold" data-sensitive>
            {showCost && row.workedCents !== null ? money(row.workedCents, currency) : ''}
          </dd>
          <dd className="text-right font-medium">
            {paidMinutes !== null ? `(${hm(paidMinutes)})` : '—'}
          </dd>
          <dt className="text-muted-foreground">Rostered</dt>
          <dd className="text-right text-muted-foreground" data-sensitive>
            {showCost && row.rosteredCents !== null ? money(row.rosteredCents, currency) : ''}
          </dd>
          <dd className="text-right text-muted-foreground">
            {shift ? `(${hm(shift.paidMinutes)})` : '—'}
          </dd>
          <dt className="text-muted-foreground">Variance</dt>
          <dd
            className={cn(
              'text-right',
              overCents !== null && overCents !== 0
                ? 'text-destructive-text'
                : 'text-muted-foreground',
            )}
            data-sensitive
          >
            {showCost && overCents !== null && overCents !== 0
              ? `${overCents > 0 ? '+' : '−'}${money(Math.abs(overCents), currency)}`
              : '--'}
          </dd>
          <dd
            className={cn(
              'text-right',
              overMinutes ? 'text-destructive-text' : 'text-muted-foreground',
            )}
          >
            {overMinutes ? `${overMinutes > 0 ? '+' : '−'}${hm(Math.abs(overMinutes))}` : '--'}
          </dd>
        </dl>
        {!locked ? (
          approved ? (
            <Button
              type="button"
              className="w-full"
              disabled={isPending}
              onClick={() => save(false)}
              title="Click to unauthorise it and change it"
            >
              <CircleCheck aria-hidden /> Authorised
            </Button>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={isPending || running || !complete || !row.canApprove}
                title={row.canApprove ? undefined : 'Someone else has to authorise your own time'}
                onClick={() => save(true)}
              >
                <Check aria-hidden /> Authorise
              </Button>
              {dirty && entry && complete && !running && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => save(false)}
                >
                  Save changes
                </Button>
              )}
              {rejected && <Badge variant="destructive">Rejected</Badge>}
            </div>
          )
        ) : (
          entry?.status === 'approved' && (
            <p className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
              <CircleCheck aria-hidden className="size-4" /> Paid
            </p>
          )
        )}
      </div>

      <div className="flex flex-row items-center justify-end gap-1 border-t px-2 py-2 lg:flex-col lg:justify-start lg:border-t-0 lg:border-l lg:py-4">
        {!locked && approved && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Unauthorise ${row.fullName}’s time`}
            title="Unauthorise"
            disabled={isPending}
            onClick={() => save(false)}
          >
            <RotateCcw aria-hidden />
          </Button>
        )}
        {!locked && entry && !approved && !running && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${row.fullName}’s recorded time`}
            disabled={isPending}
            onClick={() => run(() => deleteEntryAction({ id: entry.id }))}
          >
            <Trash2 aria-hidden />
          </Button>
        )}
      </div>
    </li>
  );
}

export function TimesheetDay({
  rows,
  date,
  currency,
  showCost,
  locked,
}: {
  rows: DayRowView[];
  date: string;
  currency: string;
  showCost: boolean;
  /** The pay period has been authorised, so nothing in it can change. */
  locked: boolean;
}) {
  return (
    <ul className="overflow-hidden rounded-xl border bg-card">
      {rows.map((row) => (
        // Keyed on what is saved, so a row takes up fresh values after each save.
        <DayRow
          key={`${row.key}|${row.entry?.id ?? ''}|${row.entry?.startTime ?? ''}|${row.entry?.endTime ?? ''}|${row.entry?.breakMinutes ?? ''}|${row.entry?.status ?? ''}`}
          row={row}
          date={date}
          currency={currency}
          showCost={showCost}
          locked={locked}
        />
      ))}
    </ul>
  );
}

/** Approves every finished, saved stretch of time on the day that is still waiting. */
export function ApproveAll({ ids }: { ids: string[] }) {
  const { run, error, isPending } = useRun();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        disabled={isPending || ids.length === 0}
        onClick={() => run(() => decideEntriesAction({ ids, decision: 'approved' }))}
      >
        <Check aria-hidden /> Authorise all{ids.length > 0 ? ` (${ids.length})` : ''}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Downloads the period's approved time: the timesheet workbook, or a plain CSV file. */
export function ExportPeriod({ date, disabled }: { date: string; disabled: boolean }) {
  const [note, setNote] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const save = (blob: Blob, filename: string, rows: number) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setNote(`Exported ${rows} authorised ${rows === 1 ? 'entry' : 'entries'}.`);
  };
  const workbook = () =>
    startTransition(async () => {
      setNote(null);
      const result = await exportTimesheetWorkbookAction({ date });
      if (!result.ok) return setNote(result.error.message);
      const bytes = Uint8Array.from(atob(result.data.base64), (char) => char.charCodeAt(0));
      save(new Blob([bytes], { type: XLSX }), result.data.filename, result.data.rows);
    });
  const csv = () =>
    startTransition(async () => {
      setNote(null);
      const result = await exportTimesheetsAction({ date });
      if (!result.ok) return setNote(result.error.message);
      save(
        new Blob([result.data.csv], { type: 'text/csv' }),
        result.data.filename,
        result.data.rows,
      );
    });
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={isPending || disabled} onClick={csv}>
          <Download aria-hidden /> CSV
        </Button>
        <Button type="button" disabled={isPending || disabled} onClick={workbook}>
          <Download aria-hidden /> Export to Excel
        </Button>
      </div>
      {note && (
        <p role="status" className="text-sm text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  );
}
