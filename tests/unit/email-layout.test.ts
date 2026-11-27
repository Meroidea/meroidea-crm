import { describe, expect, it } from 'vitest';

import { dayGroup, groupByDay, listTime } from '@/modules/social/email-layout';

const SYDNEY = 'Australia/Sydney';
// 27 Nov 2026, 10:00 in Sydney (UTC+11).
const now = new Date('2026-11-26T23:00:00Z');

describe('email list day groups', () => {
  it('groups by the business’s calendar day, not the server’s', () => {
    // 00:30 on 27 Nov in Sydney, still 26 Nov in UTC.
    expect(dayGroup(new Date('2026-11-26T13:30:00Z'), SYDNEY, now)).toBe('today');
    // 23:30 on 26 Nov in Sydney.
    expect(dayGroup(new Date('2026-11-26T12:30:00Z'), SYDNEY, now)).toBe('yesterday');
  });

  it('puts older threads in the last 7 days, last 30 days, then older', () => {
    expect(dayGroup(new Date('2026-11-22T01:00:00Z'), SYDNEY, now)).toBe('week');
    expect(dayGroup(new Date('2026-11-05T01:00:00Z'), SYDNEY, now)).toBe('month');
    expect(dayGroup(new Date('2026-09-01T01:00:00Z'), SYDNEY, now)).toBe('older');
    expect(dayGroup(null, SYDNEY, now)).toBe('older');
  });

  it('keeps the list’s order and leaves out empty groups', () => {
    const rows = [
      { id: 'a', at: new Date('2026-11-26T22:00:00Z') },
      { id: 'b', at: new Date('2026-11-26T21:00:00Z') },
      { id: 'c', at: new Date('2026-09-01T01:00:00Z') },
    ];
    const groups = groupByDay(rows, (row) => row.at, SYDNEY, now);
    expect(groups.map((g) => [g.group, g.rows.map((r) => r.id)])).toEqual([
      ['today', ['a', 'b']],
      ['older', ['c']],
    ]);
  });
});

describe('email list times', () => {
  it('shows the time today, the weekday this week and the date before that', () => {
    expect(listTime(new Date('2026-11-26T22:51:00Z'), SYDNEY, now)).toMatch(/9:51/);
    expect(listTime(new Date('2026-11-24T22:51:00Z'), SYDNEY, now)).toMatch(/^Wed/);
    expect(listTime(new Date('2026-10-02T01:00:00Z'), SYDNEY, now)).toBe('2 Oct');
    expect(listTime(new Date('2025-10-02T01:00:00Z'), SYDNEY, now)).toBe('2 Oct 2025');
    expect(listTime(null, SYDNEY, now)).toBe('');
  });
});
