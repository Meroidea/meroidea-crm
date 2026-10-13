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
        className="w-28 tabular-nums"
      />
      <span className="tabular-nums">{hint ? `Rostered ${hint}` : 'Not rostered'}</span>
    </label>
  );

  return (
    <li className="grid gap-4 border-b p-4 last:border-b-0 lg:grid-cols-[14rem_1fr_15rem]">
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden
          style={tone}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--tone)_30%,var(--card))] text-[11px] font-semibold"
        >
          {teamCode(row.team?.name) || '·'}
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium" data-sensitive>
            {row.fullName}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {row.team?.name ?? (shift ? 'No team' : 'Not rostered this day')}
          </p>
          {entry && (
            <p className="mt-1 text-xs text-muted-foreground">
              {running ? 'Still clocked in' : entry.source === 'clock' ? 'Clocked' : 'Typed in'}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start gap-3">
          {field(start, setStart, 'Start', shift?.startTime ?? null)}
          {field(end, setEnd, 'Finish', shift?.endTime ?? null)}
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
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
              className="w-20 tabular-nums"
            />
            <span>Unpaid break{shift ? ` · rostered ${shift.breakMinutes}m` : ''}</span>
          </label>
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
        </div>
        {row.lines.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Pay lines under the award ({row.lines.length})
            </summary>
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
              {row.lines.map((line) => (
                <div key={`${line.kind}|${line.label}`} className="contents">
                  <dt className="text-muted-foreground">
                    {line.label}
                    <span className="text-xs">
                      {' '}
                      ·{' '}
                      {line.minutes === null
                        ? `${formatMoney(line.rate, currency)} each`
                        : `${formatHours(line.minutes)} at ${formatMoney(line.rate, currency)}`}{' '}
                      · cl {line.clause}
                    </span>
                  </dt>
                  <dd className="text-right tabular-nums" data-sensitive>
                    {money(line.cents, currency)}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        )}
        {row.warnings.length > 0 && (
          <ul className="flex flex-col gap-1 text-xs text-warning-text">
            {row.warnings.map((warning) => (
              <li key={`${warning.clause}|${warning.message}`} className="flex items-start gap-1.5">
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

      <div className="flex flex-col gap-2">
        <dl className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-0.5 text-sm tabular-nums">
          <dt className="text-muted-foreground">Worked</dt>
          <dd className="text-right font-medium" data-sensitive>
            {showCost && row.workedCents !== null ? money(row.workedCents, currency) : ''}
          </dd>
          <dd className="text-right">
            {workedMinutes !== null
              ? formatHours(workedMinutes)
              : typedMinutes !== null && typedMinutes > 0
                ? `${formatHours(typedMinutes)} typed`
                : '—'}
          </dd>
          <dt className="text-muted-foreground">Rostered</dt>
          <dd className="text-right" data-sensitive>
            {showCost && row.rosteredCents !== null ? money(row.rosteredCents, currency) : ''}
          </dd>
          <dd className="text-right">{shift ? formatHours(shift.paidMinutes) : '—'}</dd>
          {overMinutes !== null && (
            <>
              <dt className="text-muted-foreground">Difference</dt>
              <dd
                className={cn('col-span-2 text-right', overMinutes > 0 && 'text-destructive-text')}
              >
                {overMinutes === 0 && (overCents ?? 0) === 0
                  ? 'As rostered'
                  : `${overMinutes >= 0 ? 'Over' : 'Under'} by ${formatHours(Math.abs(overMinutes))}${
                      showCost && overCents !== null
                        ? ` · ${overCents >= 0 ? '+' : '−'}${money(Math.abs(overCents), currency)}`
                        : ''
                    }`}
              </dd>
            </>
          )}
        </dl>
        {!locked && (
          <div className="flex flex-wrap items-center gap-2">
            {approved ? (
              <Button
                type="button"
                size="sm"
                disabled={isPending}
                onClick={() => save(false)}
                title="Reopen to change it"
              >
                <CircleCheck aria-hidden /> Approved
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending || running || !complete}
                  onClick={() => save(true)}
                >
                  <Check aria-hidden /> Approve
                </Button>
                {dirty && entry && complete && !running && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    onClick={() => save(false)}
                  >
                    Save
                  </Button>
                )}
              </>
            )}
            {rejected && <Badge variant="destructive">Rejected</Badge>}
            {approved && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Reopen ${row.fullName}’s time`}
                disabled={isPending}
                onClick={() => save(false)}
              >
                <RotateCcw aria-hidden />
              </Button>
            )}
            {entry && !approved && !running && (
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
        <Check aria-hidden /> Approve all{ids.length > 0 ? ` (${ids.length})` : ''}
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
    setNote(`Exported ${rows} approved ${rows === 1 ? 'entry' : 'entries'}.`);
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
