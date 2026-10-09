import { describe, expect, it } from 'vitest';

import { diffChanges } from '@/lib/audit-diff';
import { decodeCursor, encodeCursor, likePattern } from '@/lib/cursor';

describe('diffChanges', () => {
  it('records only fields that changed, and masks sensitive ones', () => {
    const before: Record<string, string | null> = {
      firstName: 'Ana',
      city: null,
      dateOfBirth: '2000-01-01',
    };
    const after = { firstName: 'Ana', city: 'Sydney', dateOfBirth: '2000-02-02' };
    expect(diffChanges(before, after, ['dateOfBirth'])).toEqual({
      city: [null, 'Sydney'],
      dateOfBirth: ['•••', '•••'],
    });
  });

  it('treats undefined and null as the same empty value', () => {
    expect(diffChanges({ lastName: null }, { lastName: undefined })).toEqual({});
  });
});

describe('list cursors', () => {
  it('round-trips and rejects tampered input', () => {
    const row = {
      createdAt: new Date('2026-09-28T01:02:03.000Z'),
      id: '6f1c1a8e-2b7a-4a55-9a1f-3f5b8a0c9d21',
    };
    expect(decodeCursor(encodeCursor(row))).toEqual(row);
    expect(decodeCursor('not-a-cursor')).toBeNull();
  });

  it('escapes LIKE wildcards in search terms', () => {
    expect(likePattern('50%_off')).toBe('%50\\%\\_off%');
  });
});
