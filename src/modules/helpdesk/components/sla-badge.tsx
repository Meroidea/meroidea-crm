'use client';

import { AlarmClock, CheckCircle2, CircleAlert, Clock, PauseCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

import { slaLabel, type SlaState } from '../sla';

/** A target as the server sends it: times as ISO strings. */
export type SlaTargetProps = {
  dueAt: string | null;
  atRiskAt: string | null;
  metAt: string | null;
  breachedAt: string | null;
  pausedAt?: string | null;
};

const TONE: Record<SlaState, string> = {
  none: 'border-border text-muted-foreground',
  met: 'border-border text-muted-foreground',
  missed: 'border-destructive/40 text-destructive-text',
  on_track: 'border-chart-2/40 bg-chart-2/10 text-foreground',
  at_risk: 'border-warning-border bg-warning/10 text-warning-text',
  breached: 'border-destructive bg-destructive/10 text-destructive-text',
  paused: 'border-border bg-muted/50 text-muted-foreground',
};

const ICON: Record<SlaState, typeof Clock> = {
  none: Clock,
  met: CheckCircle2,
  missed: CircleAlert,
  on_track: Clock,
  at_risk: AlarmClock,
  breached: CircleAlert,
  paused: PauseCircle,
};

const toDate = (value: string | null | undefined) => (value ? new Date(value) : null);

/**
 * On Track, At Risk or Breached, with a live countdown (ADR-069). It ticks every 30 seconds;
 * `serverNow` keeps the first render the same on the server and in the browser.
 */
export function SlaBadge({
  target,
  serverNow,
  prefix,
  className,
}: {
  target: SlaTargetProps;
  serverNow: string;
  prefix?: string;
  className?: string;
}) {
  const [now, setNow] = useState(() => new Date(serverNow));
  useEffect(() => {
    const tick = () => setNow(new Date());
    // Catch up with the browser's clock at once, then every 30 seconds.
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  const { state, text } = slaLabel(
    {
      dueAt: toDate(target.dueAt),
      atRiskAt: toDate(target.atRiskAt),
      metAt: toDate(target.metAt),
      breachedAt: toDate(target.breachedAt),
      pausedAt: toDate(target.pausedAt),
    },
    now,
  );
  if (state === 'none') return null;
  const Icon = ICON[state];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium tabular-nums',
        TONE[state],
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {prefix ? `${prefix}: ${text}` : text}
    </span>
  );
}
