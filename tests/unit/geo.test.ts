import { describe, expect, it } from 'vitest';

import { distanceMetres } from '@/lib/geo';
import { setLocationSchema } from '@/modules/platform/schemas';

const shop = { latitude: -33.86882, longitude: 151.20929 };

describe('distance between two points', () => {
  it('is zero for the same point', () => {
    expect(distanceMetres(shop, shop)).toBe(0);
  });

  it('measures a few metres accurately', () => {
    // 0.00005 degrees of latitude is about 5.56 m anywhere on Earth.
    expect(distanceMetres(shop, { ...shop, latitude: shop.latitude - 0.00005 })).toBeCloseTo(
      5.56,
      1,
    );
    expect(distanceMetres(shop, { ...shop, latitude: shop.latitude - 0.0002 })).toBeCloseTo(
      22.24,
      1,
    );
  });

  it('accounts for longitude shrinking away from the equator', () => {
    const east = distanceMetres(shop, { ...shop, longitude: shop.longitude + 0.0001 });
    expect(east).toBeGreaterThan(9);
    expect(east).toBeLessThan(9.5);
  });

  it('measures a long distance to within a kilometre (Sydney to Melbourne)', () => {
    const melbourne = { latitude: -37.8136, longitude: 144.9631 };
    expect(Math.abs(distanceMetres(shop, melbourne) / 1000 - 713.6)).toBeLessThan(1.5);
  });
});

describe('the business location form', () => {
  const tenantId = '7c0f1a52-6c5a-4a55-9e7f-0d6a3b1c2d3e';
  const parse = (latitude: string, longitude: string, radiusMetres: string | number = 10) =>
    setLocationSchema.safeParse({ tenantId, latitude, longitude, radiusMetres });

  it('accepts coordinates, and both empty to remove the restriction', () => {
    expect(parse('-33.868820', '151.209290').success).toBe(true);
    expect(parse('', '').success).toBe(true);
  });

  it('refuses half a location, out-of-range values and silly radii', () => {
    expect(parse('-33.868820', '').success).toBe(false);
    expect(parse('91', '151').success).toBe(false);
    expect(parse('-33', '181').success).toBe(false);
    expect(parse('-33', '151', 2).success).toBe(false);
    expect(parse('-33', '151', 5000).success).toBe(false);
    expect(parse('south', '151').success).toBe(false);
  });
});
