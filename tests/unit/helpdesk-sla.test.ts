import { describe, expect, it } from 'vitest';

import { currentTarget, formatSpan, slaLabel, slaState } from '@/modules/helpdesk/sla';

const at = (iso: string) => new Date(iso);
const now = at('2026-11-23T10:00:00Z');
const base = {
  dueAt: at('2026-11-23T12:00:00Z'),
  atRiskAt: at('2026-11-23T11:30:00Z'),
  metAt: null,
  breachedAt: null,
};

describe('a response target’s state', () => {
  it('is on track before its at-risk time, at risk after, breached once due', () => {
    expect(slaState(base, now)).toBe('on_track');
    expect(slaState(base, at('2026-11-23T11:45:00Z'))).toBe('at_risk');
    expect(slaState(base, at('2026-11-23T12:00:00Z'))).toBe('breached');
  });

  it('is met or missed once met, whatever the clock says', () => {
    expect(
      slaState({ ...base, metAt: at('2026-11-23T11:59:00Z') }, at('2026-11-24T00:00:00Z')),
    ).toBe('met');
    expect(slaState({ ...base, metAt: at('2026-11-23T12:01:00Z') }, now)).toBe('missed');
  });

  it('is paused while the clock stands still, unless it had already run out', () => {
    expect(
      slaState({ ...base, pausedAt: at('2026-11-23T09:00:00Z') }, at('2026-11-25T00:00:00Z')),
    ).toBe('paused');
    expect(slaState({ ...base, pausedAt: at('2026-11-23T13:00:00Z') }, now)).toBe('breached');
  });

  it('is breached when the sweep has marked it, even if a priority change moved the time', () => {
    expect(slaState({ ...base, breachedAt: at('2026-11-23T09:00:00Z') }, now)).toBe('breached');
  });

  it('has none without a due time', () => {
    expect(slaState({ ...base, dueAt: null }, now)).toBe('none');
  });
});

describe('the badge’s words', () => {
  it('counts down, and counts how far over', () => {
    expect(slaLabel(base, now).text).toBe('On track · 2h 00m left');
    expect(slaLabel(base, at('2026-11-23T13:05:00Z')).text).toBe('Breached · 1h 05m over');
    expect(slaLabel({ ...base, pausedAt: now }, now).text).toBe('Paused');
  });

  it('writes spans briefly', () => {
    expect(formatSpan(30_000)).toBe('under a minute');
    expect(formatSpan(12 * 60_000)).toBe('12m');
    expect(formatSpan((26 * 60 + 5) * 60_000)).toBe('1d 2h');
    expect(formatSpan(2 * 1440 * 60_000)).toBe('2d');
  });
});

describe('which target a queue row shows', () => {
  const ticket = {
    status: 'open',
    responseDueAt: base.dueAt,
    firstResponseAt: null,
    firstResponseAtRiskAt: base.atRiskAt,
    firstResponseBreachedAt: null,
    resolutionDueAt: at('2026-11-24T12:00:00Z'),
    resolutionAtRiskAt: at('2026-11-24T06:00:00Z'),
    resolutionBreachedAt: null,
    slaPausedAt: null,
    solvedAt: null,
  };

  it('is the first reply until it is sent, then the resolution', () => {
    expect(currentTarget(ticket).kind).toBe('first_response');
    expect(currentTarget({ ...ticket, firstResponseAt: now }).kind).toBe('resolution');
  });

  it('treats a solved ticket’s resolution as met, not paused', () => {
    const solved = currentTarget({
      ...ticket,
      status: 'solved',
      firstResponseAt: now,
      solvedAt: now,
      slaPausedAt: now,
    });
    expect(slaState(solved.target, now)).toBe('met');
  });
});
