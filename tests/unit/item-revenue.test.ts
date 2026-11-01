import { describe, expect, it } from 'vitest';

import { expectedRevenueFrom } from '@/modules/opportunities/item-revenue';

describe('expected revenue of an item', () => {
  it('is the base amount times the rate, rounded half up to the cent', () => {
    expect(expectedRevenueFrom('30000', '15')).toBe('4500.00');
    expect(expectedRevenueFrom('1234.55', '12.3456')).toBe('152.41');
    expect(expectedRevenueFrom('0.15', '50')).toBe('0.08');
    expect(expectedRevenueFrom('0.05', '10')).toBe('0.01');
    expect(expectedRevenueFrom('100', '0')).toBe('0.00');
  });

  it('stays exact at the largest amount a column holds', () => {
    expect(expectedRevenueFrom('999999999999.99', '100')).toBe('999999999999.99');
  });

  it('is left empty unless both the amount and the rate are known and well formed', () => {
    expect(expectedRevenueFrom(null, '15')).toBeNull();
    expect(expectedRevenueFrom('100', null)).toBeNull();
    expect(expectedRevenueFrom('1e3', '15')).toBeNull();
    expect(expectedRevenueFrom('100', '15.12345')).toBeNull();
  });
});
