import { describe, expect, it } from 'vitest';

import { toCsv } from '@/lib/csv';

describe('CSV exports', () => {
  it('shows anything that looks like a formula as text, so opening the file runs nothing', () => {
    const csv = toCsv([{ Name: '=HYPERLINK("http://example.com","x")', Note: '+1', Plain: 'Ann' }]);
    expect(csv).toContain(`"'=HYPERLINK(""http://example.com"",""x"")"`);
    expect(csv).toContain(`'+1`);
    expect(csv).toContain('Ann');
  });
});
