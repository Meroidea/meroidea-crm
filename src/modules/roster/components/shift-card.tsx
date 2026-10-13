'use client';

import { Coffee, TriangleAlert, UserRoundPlus } from 'lucide-react';
import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';
import { formatHours, teamCode } from '@/modules/roster/hours';
import type { RosterShift, RosterTeam } from '@/modules/roster/types';

/**
 * One shift on the grid: a team-coloured code, the times, and who or what it is. A dashed
 * outline and the word "Draft" mark a shift staff have not been shown in its current form.
 */
export function ShiftCard({
  shift,
  team,
  title,
  warnings,
  onOpen,
}: {
  shift: RosterShift;
  team: RosterTeam | undefined;
  /** The person's name on the day view, the team's name on the person view. */
  title: string;
  warnings: number;
  /** Present only for someone who can manage the roster. */
  onOpen?: () => void;
}) {
  const vacant = shift.userId === null;
  const tone = { '--tone': `var(--${team?.color ?? 'chart-3'})` } as CSSProperties;
  const code = teamCode(team?.name);
  const times = `${shift.startTime} to ${shift.endTime}`;
  const label = `${title}, ${times}${team ? `, ${team.name}` : ''}${
    shift.unpublishedChanges ? ', not published' : ''
  }`;

  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          'flex w-8 shrink-0 items-center justify-center rounded-l-[7px] text-[11px] font-semibold text-foreground',
          vacant
            ? 'bg-muted text-muted-foreground'
            : 'bg-[color-mix(in_srgb,var(--tone)_30%,var(--card))]',
        )}
      >
        {vacant ? <UserRoundPlus className="size-3.5" /> : code || '·'}
      </span>
      <span className="min-w-0 flex-1 px-2 py-1.5 text-left">
        <span className="flex items-center gap-1.5 text-xs font-medium tabular-nums">
          {shift.startTime} – {shift.endTime}
          {shift.overnight && <span className="text-muted-foreground">+1</span>}
          {shift.breaks.length > 0 && (
            <span className="flex items-center gap-0.5 font-normal text-muted-foreground">
              <Coffee aria-hidden className="size-3" />
              {shift.breaks.length}
            </span>
          )}
          {warnings > 0 && <TriangleAlert aria-hidden className="size-3 text-warning-text" />}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground" data-sensitive>
          {title} · {formatHours(shift.paidMinutes)}
        </span>
      </span>
      {shift.unpublishedChanges && (
        <span className="self-start rounded-bl-md bg-warning px-1 text-[10px] font-medium text-warning-text">
          Draft
        </span>
      )}
    </>
  );
  const className = cn(
    'flex w-full items-stretch overflow-hidden rounded-lg border bg-[color-mix(in_srgb,var(--tone)_7%,var(--card))]',
    vacant
      ? 'border-dashed border-input bg-card'
      : 'border-[color-mix(in_srgb,var(--tone)_45%,var(--border))]',
    shift.unpublishedChanges && !vacant && 'border-dashed',
  );

  return onOpen ? (
    <button
      type="button"
      style={tone}
      onClick={onOpen}
      aria-label={`Edit shift: ${label}`}
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
