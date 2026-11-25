import { describe, expect, it } from 'vitest';

import {
  easeInOutCubic,
  fibonacciSphere,
  LOGO_CYCLE,
  LOGO_TIMELINE,
  logoPhase,
  markWidth,
  mix,
  parseRgb,
  rgba,
  rotate,
  sampleMask,
  staggered,
  wobble,
  wordDotCount,
} from '@/components/motion/mero-orb-math';

// MeroAI's mark (ADR-078, ADR-086): the geometry, timing and colour arithmetic, without a canvas.

describe('the sphere', () => {
  it('puts every dot on the unit sphere, pole to pole', () => {
    const points = fibonacciSphere(500);
    expect(points).toHaveLength(500);
    for (const p of points) expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 9);
    expect(points[0]?.y).toBe(1);
    expect(points.at(-1)?.y).toBe(-1);
  });

  it('turning keeps a dot on the sphere', () => {
    const p = rotate({ x: 0.6, y: 0, z: 0.8 }, 1.2, 0.4);
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 9);
    expect(rotate({ x: 1, y: 0, z: 0 }, 0, 0)).toEqual({ x: 1, y: 0, z: 0 });
  });
});

describe('the dots in motion', () => {
  it('wobble stays within -1 and 1', () => {
    for (let a = 0; a < 20; a += 0.37)
      for (let b = 0; b < 20; b += 0.53) expect(Math.abs(wobble(a, b))).toBeLessThanOrEqual(1);
  });

  it('makes a small mark as wide as the word, and a large one square', () => {
    expect(markWidth(32)).toBe(83);
    expect(markWidth(20)).toBe(52);
    expect(markWidth(64)).toBe(64);
    expect(markWidth(132)).toBe(132);
  });

  it('spaces dots for the size: dotted letters when large, tighter when small, within limits', () => {
    expect(wordDotCount(1400, 132)).toBe(289);
    expect(wordDotCount(80, 32)).toBe(66);
    expect(wordDotCount(1, 20)).toBe(60);
    expect(wordDotCount(1_000_000, 400)).toBe(1400);
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

  it('loops: sphere, dots forming, resolving into the word, held, dissolving, back', () => {
    const { sphere, form, resolve, hold, dissolve } = LOGO_TIMELINE;
    expect(logoPhase(0)).toEqual({ stage: 'sphere', t: 0 });
    const forming = logoPhase(sphere + form / 2);
    expect(forming.stage).toBe('form');
    expect(forming.t).toBeCloseTo(0.5);
    expect(logoPhase(sphere + form + resolve / 2).stage).toBe('resolve');
    expect(logoPhase(sphere + form + resolve + hold / 2).stage).toBe('hold');
    expect(logoPhase(sphere + form + resolve + hold + dissolve / 2).stage).toBe('dissolve');
    expect(logoPhase(LOGO_CYCLE - 0.01).stage).toBe('release');
    expect(logoPhase(LOGO_CYCLE + 1)).toEqual(logoPhase(1));
    expect(logoPhase(-1).stage).toBe('release');
  });

  it('comes round often: a loop is under eight seconds, the typed word held about two', () => {
    expect(LOGO_CYCLE).toBeLessThan(8);
    expect(LOGO_TIMELINE.hold).toBeGreaterThanOrEqual(2);
  });

  it('writes from left to right: the left dots land first', () => {
    expect(staggered(0.5, 0)).toBeGreaterThan(staggered(0.5, 1));
    expect(staggered(0, 0)).toBe(0);
    expect(staggered(1, 1)).toBe(1);
  });

  it('eases in and out', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(2)).toBe(1);
  });
});
