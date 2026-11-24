import { describe, expect, it, vi } from 'vitest';

import { sniffAttachmentType } from '@/modules/ai/attachments';
import { decimalString, invoiceTotals, lineTotal } from '@/modules/ai/invoice-math';
import {
  backoffDelayMs,
  serverRetryDelayMs,
  withBackoff,
  type RetryOptions,
} from '@/modules/ai/retry';
import { solveRoster, weekdayOf, type SolverInput } from '@/modules/ai/roster-solver';

const apiError = (status: number, message = 'failed') =>
  Object.assign(new Error(message), { status });

describe('model retries', () => {
  const options = (sleep: (ms: number) => Promise<void>): RetryOptions => ({
    retries: 2,
    baseDelayMs: 1000,
    maxDelayMs: 8000,
    sleep,
    random: () => 0.5,
  });

  it('retries a rate limit at most twice, then gives up with the error', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const run = vi.fn(async () => {
      throw apiError(429);
    });
    await expect(withBackoff(run, options(sleep))).rejects.toMatchObject({ status: 429 });
    expect(run).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([750, 1500]);
  });

  it('succeeds once the rate limit clears', async () => {
    let calls = 0;
    const result = await withBackoff(
      async () => {
        calls += 1;
        if (calls === 1) throw apiError(503);
        return 'answer';
      },
      options(async () => {}),
    );
    expect(result).toBe('answer');
    expect(calls).toBe(2);
  });

  it('does not retry a request the API refused outright', async () => {
    const run = vi.fn(async () => {
      throw apiError(400);
    });
    await expect(
      withBackoff(
        run,
        options(async () => {}),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('waits as long as Google asks when that is short', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    let calls = 0;
    await withBackoff(async () => {
      calls += 1;
      if (calls === 1) throw apiError(429, '{"error":{"details":[{"retryDelay":"5s"}]}}');
      return 'ok';
    }, options(sleep));
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it('gives up at once when the quota is gone for longer than it is worth waiting', async () => {
    const run = vi.fn(async () => {
      throw apiError(429, '{"error":{"details":[{"retryDelay":"3600s"}]}}');
    });
    await expect(
      withBackoff(
        run,
        options(async () => {}),
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reads the retry delay and caps backoff', () => {
    expect(serverRetryDelayMs(new Error('"retryDelay": "1.5s"'))).toBe(1500);
    expect(serverRetryDelayMs(new Error('nothing here'))).toBeNull();
    expect(
      backoffDelayMs(10, { retries: 2, baseDelayMs: 1000, maxDelayMs: 8000, random: () => 0.99 }),
    ).toBe(8000);
  });
});

describe('invoice preview totals', () => {
  it('rounds each line half up to the cent, as the database does', () => {
    expect(lineTotal('1.5', '0.33')).toBe('0.50'); // 0.495
    expect(lineTotal('3', '19.99')).toBe('59.97');
    expect(lineTotal('0.333', '10.00')).toBe('3.33');
  });

  it('adds tax on the subtotal', () => {
    expect(
      invoiceTotals(
        [
          { quantity: '2', unitPrice: '100' },
          { quantity: '1', unitPrice: '0.05' },
        ],
        '10',
      ),
    ).toEqual({
      subtotal: '200.05',
      taxTotal: '20.01',
      total: '220.06',
    });
    expect(invoiceTotals([{ quantity: 'x', unitPrice: '1' }], '10')).toBeNull();
  });

  it('turns model numbers into plain decimals', () => {
    expect(decimalString(2, 3)).toBe('2');
    expect(decimalString(1.25, 3)).toBe('1.25');
    expect(decimalString(1.23456, 3)).toBe('1.235');
    expect(decimalString(-1, 2)).toBeNull();
    expect(decimalString(Number.NaN, 2)).toBeNull();
  });
});

describe('attachment types come from the bytes, not the name', () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  it('recognises documents and images', () => {
    expect(sniffAttachmentType(bytes('%PDF-1.7 ...'), 'x.bin')).toBe('application/pdf');
    expect(sniffAttachmentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]), 'a.png')).toBe(
      'image/png',
    );
    expect(sniffAttachmentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'a.jpg')).toBe(
      'image/jpeg',
    );
    expect(sniffAttachmentType(bytes('RIFF\0\0\0\0WEBPVP8 '), 'a.webp')).toBe('image/webp');
    expect(sniffAttachmentType(bytes('\0\0\0\x18ftypheic'), 'a.heic')).toBe('image/heic');
  });

  it('accepts text only with a text extension and no binary content', () => {
    expect(sniffAttachmentType(bytes('Contract renews 1 July.'), 'notes.txt')).toBe('text/plain');
    expect(sniffAttachmentType(bytes('Contract renews 1 July.'), 'notes.exe')).toBeNull();
    expect(sniffAttachmentType(new Uint8Array([0x4d, 0x5a, 0x00, 0x01]), 'renamed.txt')).toBeNull();
  });

  it('refuses a renamed executable', () => {
    expect(sniffAttachmentType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]), 'invoice.pdf')).toBeNull();
  });
});

describe('roster solver', () => {
  // 2026-11-30 is a Monday.
  const week = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'];
  const people = [
    { userId: 'ana', name: 'Ana', teamIds: ['floor'] },
    { userId: 'ben', name: 'Ben', teamIds: ['floor'] },
    { userId: 'cai', name: 'Cai', teamIds: ['kitchen'] },
  ];
  const base: SolverInput = {
    dates: week,
    requirements: [
      {
        weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
        startTime: '07:00',
        endTime: '15:00',
        staffNeeded: 1,
        teamId: null,
        note: null,
      },
    ],
    people,
    leave: [],
    existing: [],
    breakRules: [{ fromMinutes: 300, minutes: 30, paid: false }],
  };

  it('knows its weekdays', () => {
    expect(weekdayOf('2026-11-30')).toBe('mon');
    expect(weekdayOf('2026-12-06')).toBe('sun');
  });

  it('spreads the hours evenly and applies break rules', () => {
    const result = solveRoster(base);
    expect(result.shifts).toHaveLength(5);
    expect(result.unfilled).toBe(0);
    const counts = result.load.map((load) => load.newShifts).sort();
    expect(counts).toEqual([1, 2, 2]);
    expect(result.shifts[0]).toMatchObject({
      paidMinutes: 450,
      breaks: [{ minutes: 30, paid: false }],
    });
  });

  it('gives the same roster for the same request', () => {
    expect(solveRoster(base)).toEqual(solveRoster(base));
  });

  it('never rosters anyone on leave, pending or approved', () => {
    const result = solveRoster({
      ...base,
      leave: [
        { userId: 'ana', startsOn: '2026-11-30', endsOn: '2026-12-04' },
        { userId: 'ben', startsOn: '2026-12-01', endsOn: '2026-12-01' },
      ],
    });
    expect(result.shifts.some((shift) => shift.userId === 'ana')).toBe(false);
    expect(result.shifts.find((shift) => shift.date === '2026-12-01')?.userId).toBe('cai');
  });

  it('never double-books someone who already has a shift, and counts those hours', () => {
    const result = solveRoster({
      ...base,
      people: [people[0]!, people[1]!],
      existing: [{ userId: 'ana', date: '2026-11-30', startTime: '10:00', endTime: '18:00' }],
    });
    expect(result.shifts.find((shift) => shift.date === '2026-11-30')?.userId).toBe('ben');
    // Ana starts the week with 7.5 hours, so Ben takes the extra shift.
    expect(result.load.find((load) => load.userId === 'ben')?.newShifts).toBe(3);
  });

  it('keeps an overnight shift from clashing with the next morning', () => {
    const result = solveRoster({
      ...base,
      dates: ['2026-11-30', '2026-12-01'],
      requirements: [
        {
          weekdays: ['mon'],
          startTime: '22:00',
          endTime: '06:00',
          staffNeeded: 1,
          teamId: null,
          note: null,
        },
        {
          weekdays: ['tue'],
          startTime: '05:00',
          endTime: '09:00',
          staffNeeded: 1,
          teamId: null,
          note: null,
        },
      ],
      people: [people[0]!, people[1]!],
    });
    const [night, morning] = result.shifts;
    expect(night?.userId).toBeTruthy();
    expect(morning?.userId).toBeTruthy();
    expect(morning?.userId).not.toBe(night?.userId);
  });

  it('keeps the one person who can work a team shift free for it', () => {
    const result = solveRoster({
      ...base,
      dates: ['2026-11-30'],
      people: [
        { userId: 'ana', name: 'Ana', teamIds: [] },
        { userId: 'ben', name: 'Ben', teamIds: ['bar'] },
        { userId: 'cai', name: 'Cai', teamIds: [] },
      ],
      requirements: [
        {
          weekdays: ['mon'],
          startTime: '07:00',
          endTime: '15:00',
          staffNeeded: 2,
          teamId: null,
          note: null,
        },
        {
          weekdays: ['mon'],
          startTime: '09:00',
          endTime: '13:00',
          staffNeeded: 1,
          teamId: 'bar',
          note: null,
        },
      ],
    });
    expect(result.unfilled).toBe(0);
    expect(result.shifts.find((shift) => shift.teamId === 'bar')?.userId).toBe('ben');
    expect(result.shifts.map((shift) => shift.startTime)).toEqual(['07:00', '07:00', '09:00']);
  });

  it('only rosters a team’s own members, and leaves a shift vacant when nobody can take it', () => {
    const result = solveRoster({
      ...base,
      dates: ['2026-11-30'],
      requirements: [
        {
          weekdays: ['mon'],
          startTime: '09:00',
          endTime: '17:00',
          staffNeeded: 2,
          teamId: 'kitchen',
          note: null,
        },
      ],
    });
    expect(result.shifts.map((shift) => shift.userId)).toEqual(['cai', null]);
    expect(result.unfilled).toBe(1);
    expect(result.warnings[0]).toContain('left vacant');
  });
});
