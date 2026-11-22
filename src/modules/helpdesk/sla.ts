/*
 * What a ticket's response target looks like right now (ADR-069). The database works out every
 * due and at-risk time in business hours; here they are only compared with the clock, so the
 * browser can count down without knowing anything about opening hours.
 */

export type SlaTarget = {
  dueAt: Date | null;
  atRiskAt: Date | null;
  /** When the target was met: the first reply, or the ticket solved. */
  metAt: Date | null;
  breachedAt: Date | null;
  /** Since when the clock has stood still (resolution only). */
  pausedAt?: Date | null;
};

export type SlaState = 'none' | 'met' | 'missed' | 'on_track' | 'at_risk' | 'breached' | 'paused';

export function slaState(target: SlaTarget, now: Date): SlaState {
  const { dueAt, atRiskAt, metAt, breachedAt, pausedAt } = target;
  if (!dueAt) return 'none';
  if (metAt) return metAt <= dueAt ? 'met' : 'missed';
  if (pausedAt) return breachedAt || dueAt <= pausedAt ? 'breached' : 'paused';
  if (breachedAt || now >= dueAt) return 'breached';
  if (atRiskAt && now >= atRiskAt) return 'at_risk';
  return 'on_track';
}

/** "2d 4h", "3h 05m", "12m", "under a minute". */
export function formatSpan(ms: number): string {
  const minutes = Math.floor(Math.abs(ms) / 60_000);
  if (minutes < 1) return 'under a minute';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h ${String(rest).padStart(2, '0')}m`;
  return `${rest}m`;
}

export const SLA_STATE_LABELS: Record<SlaState, string> = {
  none: 'No target',
  met: 'Met',
  missed: 'Missed',
  on_track: 'On track',
  at_risk: 'At risk',
  breached: 'Breached',
  paused: 'Paused',
};

/** The words on a badge: the state, and how long is left or how far over it is. */
export function slaLabel(target: SlaTarget, now: Date): { state: SlaState; text: string } {
  const state = slaState(target, now);
  const label = SLA_STATE_LABELS[state];
  if (!target.dueAt) return { state, text: label };
  const left = target.dueAt.getTime() - now.getTime();
  if (state === 'on_track' || state === 'at_risk') {
    return { state, text: `${label} · ${formatSpan(left)} left` };
  }
  if (state === 'breached' && !target.pausedAt) {
    return { state, text: `${label} · ${formatSpan(left)} over` };
  }
  return { state, text: label };
}

/**
 * The target that matters on a queue row: the first response until it is sent, then the
 * resolution.
 */
export function currentTarget(ticket: {
  status: string;
  responseDueAt: Date;
  firstResponseAt: Date | null;
  firstResponseAtRiskAt: Date | null;
  firstResponseBreachedAt: Date | null;
  resolutionDueAt: Date | null;
  resolutionAtRiskAt: Date | null;
  resolutionBreachedAt: Date | null;
  slaPausedAt: Date | null;
  solvedAt: Date | null;
}): { kind: 'first_response' | 'resolution'; target: SlaTarget } {
  if (!ticket.firstResponseAt && !['solved', 'closed'].includes(ticket.status)) {
    return { kind: 'first_response', target: firstResponseTarget(ticket) };
  }
  return { kind: 'resolution', target: resolutionTarget(ticket) };
}

export function firstResponseTarget(ticket: {
  responseDueAt: Date;
  firstResponseAt: Date | null;
  firstResponseAtRiskAt: Date | null;
  firstResponseBreachedAt: Date | null;
}): SlaTarget {
  return {
    dueAt: ticket.responseDueAt,
    atRiskAt: ticket.firstResponseAtRiskAt,
    metAt: ticket.firstResponseAt,
    breachedAt: ticket.firstResponseBreachedAt,
  };
}

export function resolutionTarget(ticket: {
  status: string;
  resolutionDueAt: Date | null;
  resolutionAtRiskAt: Date | null;
  resolutionBreachedAt: Date | null;
  slaPausedAt: Date | null;
  solvedAt: Date | null;
}): SlaTarget {
  const done = ticket.status === 'solved' || ticket.status === 'closed';
  return {
    dueAt: ticket.resolutionDueAt,
    atRiskAt: ticket.resolutionAtRiskAt,
    metAt: done ? ticket.solvedAt : null,
    breachedAt: ticket.resolutionBreachedAt,
    pausedAt: done ? null : ticket.slaPausedAt,
  };
}

/** A target ready to hand to the browser's badge: times as ISO strings. */
export function targetProps(target: SlaTarget) {
  const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);
  return {
    dueAt: iso(target.dueAt),
    atRiskAt: iso(target.atRiskAt),
    metAt: iso(target.metAt),
    breachedAt: iso(target.breachedAt),
    pausedAt: iso(target.pausedAt),
  };
}
