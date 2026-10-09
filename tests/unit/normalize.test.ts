import { describe, expect, it } from 'vitest';

import { normalizeEmail, normalizePhone } from '@/lib/normalize';

describe('normalizePhone', () => {
  it('turns a national number into international form using the workspace country', () => {
    expect(normalizePhone('0412 345 678', 'AU')).toBe('+61412345678');
    expect(normalizePhone('021 123 4567', 'NZ')).toBe('+64211234567');
  });

  it('keeps numbers that are already international', () => {
    expect(normalizePhone('+61 412-345-678', 'AU')).toBe('+61412345678');
    expect(normalizePhone('0061 412 345 678', 'AU')).toBe('+61412345678');
    expect(normalizePhone('+977 9801234567', 'AU')).toBe('+9779801234567');
  });

  it('ignores fragments too short to be a phone number', () => {
    expect(normalizePhone('12 34', 'AU')).toBeNull();
    expect(normalizePhone('', 'AU')).toBeNull();
    expect(normalizePhone(null, 'AU')).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('compares addresses case- and whitespace-insensitively', () => {
    expect(normalizeEmail('  Ana.Lima@Example.COM ')).toBe('ana.lima@example.com');
    expect(normalizeEmail('   ')).toBeNull();
  });
});
