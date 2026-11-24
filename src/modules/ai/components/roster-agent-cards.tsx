'use client';

import {
  AlertTriangle,
  CalendarRange,
  Check,
  ChevronDown,
  CircleCheck,
  ThumbsDown,
  ThumbsUp,
  UserRoundX,
} from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { dayParts, formatHours } from '@/modules/roster/hours';
import type { TeamColor } from '@/modules/roster/rules';

import { rosterFeedbackAction } from '../actions';
import type {
  ChangeShiftArtifact,
  FillVacantArtifact,
  RemoveShiftsArtifact,
  RosterCheck,
  RosterPreviewArtifact,
} from '../types';

export type CardStatus = 'open' | 'applying' | 'applied' | 'discarded';

const tone = (color: TeamColor | undefined) =>
  ({ '--tone': `var(--${color ?? 'chart-3'})` }) as CSSProperties;

function Shell({
  label,
  status,
  children,
  footer,
}: {
  label: string;
  status: CardStatus;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-xs',
        status === 'discarded' && 'opacity-60',
      )}
    >
      <p
        className={cn(
          'text-[0.7rem] font-semibold tracking-wider uppercase',
          status === 'applied' ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        {status === 'applied' ? (
          <span className="inline-flex items-center gap-1">
            <CircleCheck aria-hidden className="size-3.5" /> Applied
          </span>
        ) : status === 'discarded' ? (
          'Discarded'
        ) : (
          label
        )}
      </p>
      {children}
      {footer && status !== 'applied' && status !== 'discarded' && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">{footer}</div>
      )}
    </div>
  );
}

function Notes({ items, tone: kind }: { items: string[]; tone: 'info' | 'warning' }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, 3);
  return (
    <div className="flex flex-col gap-1">
      <ul
        className={cn(
          'flex flex-col gap-1 rounded-lg p-2.5 text-xs',
          kind === 'warning' ? 'bg-warning text-warning-text' : 'bg-muted text-muted-foreground',
        )}
      >
        {shown.map((item, index) => (
          <li key={`${index}-${item}`} className="flex gap-1.5">
            {kind === 'warning' ? (
              <AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" />
            ) : (
              <Check aria-hidden className="mt-0.5 size-3 shrink-0" />
            )}
            {item}
          </li>
        ))}
      </ul>
      {items.length > 3 && (
        <button
          type="button"
          onClick={() => setAll((value) => !value)}
          className="self-start text-xs text-primary underline-offset-4 hover:underline"
        >
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

/** The agent's plan: shifts and hours by team, cover, cost, and what it took from the notes. */
export function PlanCard({
  artifact,
  status,
  teamColors,
  onApprove,
  onDiscard,
}: {
  artifact: RosterPreviewArtifact;
  status: CardStatus;
  teamColors: Record<string, TeamColor>;
  onApprove: () => void;
  onDiscard: () => void;
}) {
  const [showShifts, setShowShifts] = useState(false);
  const totalMinutes = artifact.shifts.reduce((sum, shift) => sum + shift.paidMinutes, 0);
  const byTeam = new Map<
    string,
    { name: string; color?: TeamColor; shifts: number; minutes: number }
  >();
  for (const shift of artifact.shifts) {
    const key = shift.teamId ?? 'none';
    const row = byTeam.get(key) ?? {
      name: shift.teamName ?? 'No team',
      color: shift.teamId ? teamColors[shift.teamId] : undefined,
      shifts: 0,
      minutes: 0,
    };
    row.shifts += 1;
    row.minutes += shift.paidMinutes;
    byTeam.set(key, row);
  }
  const teams = [...byTeam.values()].sort((a, b) => b.minutes - a.minutes);
  const filled = artifact.shifts.length - artifact.unfilled;
  const days = [...new Set(artifact.shifts.map((shift) => shift.date))];
  const replacing = artifact.replaces?.length ?? 0;

  return (
    <Shell
      label="Proposed plan"
      status={status}
      footer={
        <>
          <Button
            size="sm"
            className="meroai-button"
            disabled={status === 'applying'}
            onClick={onApprove}
          >
            {status === 'applying' ? 'Applying…' : 'Approve and apply'}
          </Button>
          <Button size="sm" variant="ghost" disabled={status === 'applying'} onClick={onDiscard}>
            Discard
          </Button>
        </>
      }
    >
      <div>
        <p className="text-2xl font-semibold tracking-tight tabular-nums">
          {artifact.shifts.length} shifts · {formatHours(totalMinutes)}
        </p>
        <p className="text-sm text-muted-foreground">
          {teams.length} {teams.length === 1 ? 'team' : 'teams'} covered · {filled} filled
          {artifact.unfilled > 0 && `, ${artifact.unfilled} vacant`}
          {replacing > 0 && ` · replaces ${replacing} existing`}
        </p>
      </div>

      <ul className="flex flex-col divide-y border-y text-sm">
        {teams.map((team) => (
          <li
            key={team.name}
            className="flex items-center justify-between gap-2 py-1.5"
            style={tone(team.color)}
          >
            <span className="flex items-center gap-2">
              <span aria-hidden className="size-2 rounded-full bg-(--tone)" />
              {team.name}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {team.shifts} {team.shifts === 1 ? 'shift' : 'shifts'} · {formatHours(team.minutes)}
            </span>
          </li>
        ))}
      </ul>

      <dl className="grid grid-cols-2 gap-2 text-xs">
        {artifact.coverage && (
          <div className="rounded-lg bg-muted px-2.5 py-2">
            <dt className="text-muted-foreground">Cover</dt>
            <dd className="font-medium tabular-nums">
              {formatHours(artifact.coverage.plannedMinutes)} of{' '}
              {formatHours(artifact.coverage.neededMinutes)} needed
            </dd>
          </div>
        )}
        {artifact.estimatedCost && (
          <div className="rounded-lg bg-muted px-2.5 py-2">
            <dt className="text-muted-foreground">Estimated wages</dt>
            <dd className="font-medium tabular-nums" data-sensitive>
              {formatMoney(artifact.estimatedCost.total, artifact.estimatedCost.currency)}
              {artifact.estimatedCost.unpriced > 0 && (
                <span className="font-normal text-muted-foreground">
                  {' '}
                  + {artifact.estimatedCost.unpriced} unpriced
                </span>
              )}
            </dd>
          </div>
        )}
      </dl>

      {artifact.notesApplied && artifact.notesApplied.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium">From your notes</p>
          <Notes items={artifact.notesApplied} tone="info" />
        </div>
      )}
      {artifact.coverage && artifact.coverage.gaps.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium">Short of your staff numbers</p>
          <Notes
            tone="warning"
            items={artifact.coverage.gaps.map(
              (gap) => `${formatCalendarDate(gap.date)}, ${gap.from}–${gap.to}: ${gap.short} short`,
            )}
          />
        </div>
      )}
      {artifact.warnings.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium">Things to check</p>
          <Notes items={artifact.warnings} tone="warning" />
        </div>
      )}

      <button
        type="button"
        aria-expanded={showShifts}
        onClick={() => setShowShifts((value) => !value)}
        className="flex items-center gap-1 self-start text-xs font-medium text-primary"
      >
        <ChevronDown
          aria-hidden
          className={cn('size-3.5 transition-transform', showShifts && 'rotate-180')}
        />
        {showShifts ? 'Hide shifts' : 'See every shift'}
      </button>
      {showShifts && (
        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
          {days.map((date) => (
            <div key={date}>
              <p className="text-xs font-medium text-muted-foreground">
                {dayParts(date).weekday} {dayParts(date).day}
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {artifact.shifts
                  .filter((shift) => shift.date === date)
                  .map((shift, index) => (
                    <li
                      key={`${shift.startTime}-${index}`}
                      style={tone(shift.teamId ? teamColors[shift.teamId] : undefined)}
                      className="flex items-center gap-2 rounded-md border-l-[3px] border-(--tone) bg-muted/60 px-2 py-1 text-xs"
                    >
                      <span className="tabular-nums">
                        {shift.startTime}–{shift.endTime}
                      </span>
                      <span className={cn('truncate', !shift.userId && 'text-warning-text')}>
                        {shift.personName ?? 'Vacant'}
                      </span>
                      {shift.teamName && (
                        <span className="ml-auto truncate text-muted-foreground">
                          {shift.teamName}
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

export function FillCard({
  artifact,
  status,
  onApprove,
  onDiscard,
}: {
  artifact: FillVacantArtifact;
  status: CardStatus;
  onApprove: () => void;
  onDiscard: () => void;
}) {
  return (
    <Shell
      label="Fill vacant shifts"
      status={status}
      footer={
        artifact.assignments.length > 0 && (
          <>
            <Button
              size="sm"
              className="meroai-button"
              disabled={status === 'applying'}
              onClick={onApprove}
            >
              {status === 'applying' ? 'Filling…' : `Give out ${artifact.assignments.length}`}
            </Button>
            <Button size="sm" variant="ghost" disabled={status === 'applying'} onClick={onDiscard}>
              Discard
            </Button>
          </>
        )
      }
    >
      <p className="text-sm">
        {artifact.assignments.length} of {artifact.vacant} vacant shifts can be filled.
      </p>
      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto text-xs">
        {artifact.assignments.map((item) => (
          <li
            key={item.shiftId}
            className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1"
          >
            <span className="w-20 shrink-0 text-muted-foreground">
              {dayParts(item.date).weekday} {dayParts(item.date).day}
            </span>
            <span className="tabular-nums">
              {item.startTime}–{item.endTime}
            </span>
            <span className="ml-auto truncate font-medium">{item.personName}</span>
          </li>
        ))}
      </ul>
      <Notes items={artifact.warnings} tone="warning" />
    </Shell>
  );
}

export function RemoveCard({
  artifact,
  status,
  onApprove,
  onDiscard,
}: {
  artifact: RemoveShiftsArtifact;
  status: CardStatus;
  onApprove: () => void;
  onDiscard: () => void;
}) {
  return (
    <Shell
      label="Remove shifts"
      status={status}
      footer={
        <>
          <Button
            size="sm"
            variant="destructive"
            disabled={status === 'applying'}
            onClick={onApprove}
          >
            {status === 'applying' ? 'Removing…' : `Remove ${artifact.shiftIds.length}`}
          </Button>
          <Button size="sm" variant="ghost" disabled={status === 'applying'} onClick={onDiscard}>
            Keep them
          </Button>
        </>
      }
    >
      <p className="text-sm font-medium">{artifact.description}</p>
      <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto text-xs text-muted-foreground">
        {artifact.shifts.slice(0, 60).map((shift, index) => (
          <li key={`${shift.date}-${shift.startTime}-${index}`} className="flex gap-2">
            <span className="w-20 shrink-0">
              {dayParts(shift.date).weekday} {dayParts(shift.date).day}
            </span>
            <span className="tabular-nums">
              {shift.startTime}–{shift.endTime}
            </span>
            <span className="ml-auto truncate">{shift.personName ?? 'Vacant'}</span>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

export function ChangeCard({
  artifact,
  status,
  onApprove,
  onDiscard,
}: {
  artifact: ChangeShiftArtifact;
  status: CardStatus;
  onApprove: () => void;
  onDiscard: () => void;
}) {
  return (
    <Shell
      label="Change a shift"
      status={status}
      footer={
        <>
          <Button
            size="sm"
            className="meroai-button"
            disabled={status === 'applying'}
            onClick={onApprove}
          >
            {status === 'applying' ? 'Saving…' : 'Confirm'}
          </Button>
          <Button size="sm" variant="ghost" disabled={status === 'applying'} onClick={onDiscard}>
            Discard
          </Button>
        </>
      }
    >
      <p className="flex items-center gap-2 text-sm">
        <CalendarRange aria-hidden className="size-4 text-muted-foreground" />
        {formatCalendarDate(artifact.date)}, {artifact.startTime}–{artifact.endTime}
      </p>
      <p className="flex items-center gap-2 text-sm">
        {artifact.toName ? null : (
          <UserRoundX aria-hidden className="size-4 text-muted-foreground" />
        )}
        <span className="text-muted-foreground">{artifact.fromName ?? 'Vacant'}</span>
        <span aria-hidden>→</span>
        <span className="font-medium">{artifact.toName ?? 'Vacant'}</span>
      </p>
    </Shell>
  );
}

/** The agent's check after a change, with a thumbs up or down. */
export function CheckCard({ check }: { check: RosterCheck }) {
  const [rated, setRated] = useState<'up' | 'down' | null>(null);
  const rate = (rating: 'up' | 'down') => {
    setRated(rating);
    void rosterFeedbackAction({ rating, about: 'check' });
  };
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        {check.vacant === 0 && check.findings.length === 0
          ? `The roster is complete: ${check.shifts} shifts, ${formatHours(check.rosteredMinutes)}, and nothing needs you.`
          : `The roster has ${check.shifts} shifts (${formatHours(check.rosteredMinutes)}${
              check.neededMinutes !== null ? ` of ${formatHours(check.neededMinutes)} needed` : ''
            }). ${check.findings.length ? 'These still need you:' : ''}`}
      </p>
      {check.findings.length > 0 && <Notes items={check.findings} tone="warning" />}
      <div className="flex items-center gap-1 text-muted-foreground">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="This was helpful"
          aria-pressed={rated === 'up'}
          disabled={rated !== null}
          onClick={() => rate('up')}
        >
          <ThumbsUp aria-hidden className={cn('size-3.5', rated === 'up' && 'text-primary')} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="This was not helpful"
          aria-pressed={rated === 'down'}
          disabled={rated !== null}
          onClick={() => rate('down')}
        >
          <ThumbsDown aria-hidden className={cn('size-3.5', rated === 'down' && 'text-primary')} />
        </Button>
        {rated && <span className="text-xs">Thanks for the feedback.</span>}
      </div>
    </div>
  );
}
