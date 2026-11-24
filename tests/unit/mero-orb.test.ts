import { describe, expect, it } from 'vitest';

import {
  easeInOutCubic,
  fibonacciSphere,
  mix,
  MORPH_CYCLE,
  MORPH_TIMELINE,
  morphState,
  parseRgb,
  particleCount,
  rgba,
  rotate,
  sampleMask,
  staggered,
  wobble,
} from '@/components/motion/mero-orb-math';

// The MeroAI orb (ADR-078): the geometry and colour arithmetic, without a canvas.

describe('the orb shell', () => {
  it('puts every particle on the unit sphere, pole to pole', () => {
    const points = fibonacciSphere(500);
    expect(points).toHaveLength(500);
    for (const p of points) expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 9);
    expect(points[0]?.y).toBe(1);
    expect(points.at(-1)?.y).toBe(-1);
  });

  it('spreads particles evenly, with no clump at the poles', () => {
    const points = fibonacciSphere(1000);
    const northCap = points.filter((p) => p.y > 0.8).length;
    const equatorBand = points.filter((p) => Math.abs(p.y) < 0.1).length;
    // Equal-area bands hold equal shares: both are a tenth of the sphere's surface.
    expect(northCap).toBeGreaterThan(90);
    expect(northCap).toBeLessThan(110);
    expect(equatorBand).toBeGreaterThan(90);
    expect(equatorBand).toBeLessThan(110);
  });

  it('handles a single particle', () => {
    const [only] = fibonacciSphere(1);
    expect(only?.y).toBe(1);
    expect(Math.hypot(only?.x ?? 0, only?.y ?? 0, only?.z ?? 0)).toBeCloseTo(1, 9);
  });

  it('turning keeps a point on the sphere', () => {
    const p = rotate({ x: 0.6, y: 0.0, z: 0.8 }, 1.2, 0.4);
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 9);
    expect(rotate({ x: 1, y: 0, z: 0 }, 0, 0)).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('draws more particles on a bigger orb, within limits', () => {
    expect(particleCount(10)).toBe(70);
    expect(particleCount(60)).toBe(432);
    expect(particleCount(400)).toBe(1100);
  });

  it('wobble stays within -1 and 1', () => {
    for (let a = 0; a < 20; a += 0.37)
      for (let b = 0; b < 20; b += 0.53) expect(Math.abs(wobble(a, b))).toBeLessThanOrEqual(1);
  });
});

describe('orb colours from the theme', () => {
  it('reads the forms a canvas reports back', () => {
    expect(parseRgb('#4b49ac')).toEqual({ r: 75, g: 73, b: 172 });
    expect(parseRgb('rgba(243, 121, 126, 0.5)')).toEqual({ r: 243, g: 121, b: 126 });
    expect(parseRgb('rgb(1 2 3)')).toEqual({ r: 1, g: 2, b: 3 });
    expect(parseRgb('oklch(0.5 0.1 270)')).toBeNull();
  });

  it('mixes and clamps', () => {
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };
    expect(mix(black, white, 0.5)).toEqual({ r: 128, g: 128, b: 128 });
    expect(mix(black, white, 3)).toEqual(white);
    expect(rgba(white, 2)).toBe('rgba(255, 255, 255, 1)');
  });
});

describe('the orb writing meroAI', () => {
  // A 10×4 mask with one opaque 4×2 block in the middle.
  const mask = (() => {
    const width = 10;
    const height = 4;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 1; y < 3; y += 1)
      for (let x = 3; x < 7; x += 1) data[(y * width + x) * 4 + 3] = 255;
    return { width, height, data };
  })();

  it('places every dot inside the letters, left to right, the same way each time', () => {
    const points = sampleMask(mask, 8);
    expect(points).toHaveLength(8);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(-0.4);
      expect(p.x).toBeLessThanOrEqual(0.4);
    }
    for (let i = 1; i < points.length; i += 1)
      expect(points[i]!.x).toBeGreaterThanOrEqual(points[i - 1]!.x);
    expect(sampleMask(mask, 8)).toEqual(points);
  });

  it('repeats letter pixels when there are more dots than pixels', () => {
    expect(sampleMask(mask, 50)).toHaveLength(50);
    expect(sampleMask({ width: 2, height: 2, data: new Uint8ClampedArray(16) }, 5)).toEqual([]);
  });

  it('loops: sphere, forming, held, coming apart', () => {
    const { sphere, form, hold, release } = MORPH_TIMELINE;
    expect(morphState(0)).toEqual({ amount: 0, forming: true });
    expect(morphState(sphere + form / 2).amount).toBeCloseTo(0.5);
    expect(morphState(sphere + form + hold / 2)).toEqual({ amount: 1, forming: true });
    const apart = morphState(sphere + form + hold + release / 2);
    expect(apart.amount).toBeCloseTo(0.5);
    expect(apart.forming).toBe(false);
    expect(morphState(MORPH_CYCLE + 1)).toEqual(morphState(1));
  });

  it('writes from left to right: the left dots land first', () => {
    expect(staggered(0.5, 0, true)).toBeGreaterThan(staggered(0.5, 1, true));
    expect(staggered(1, 1, true)).toBe(1);
    expect(staggered(0, 0, true)).toBe(0);
    expect(staggered(0, 1, false)).toBe(0);
    expect(staggered(1, 0, false)).toBe(1);
  });

  it('eases in and out', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(2)).toBe(1);
  });
});
