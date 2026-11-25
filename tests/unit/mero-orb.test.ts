import { describe, expect, it } from 'vitest';

import {
  dotProgress,
  easeInOutCubic,
  markWidth,
  mix,
  outAndBack,
  parseRgb,
  rgba,
  sampleMask,
  seededCloud,
  seededShuffle,
  WORD_CYCLE,
  WORD_EFFECTS,
  WORD_TIMELINE,
  wobble,
  wordDotCount,
  wordPhase,
} from '@/components/motion/mero-orb-math';

// MeroAI's mark (ADR-078, ADR-080, ADR-085): the geometry, timing and colour arithmetic, without a
// canvas.

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

  it('holds the word, then reworks it, one change after another', () => {
    const { hold, change } = WORD_TIMELINE;
    expect(wordPhase(0)).toEqual({ cycle: 0, effect: 'scatter', progress: 0 });
    expect(wordPhase(hold + change / 2).progress).toBeCloseTo(0.5);
    expect(WORD_EFFECTS.map((_, cycle) => wordPhase(cycle * WORD_CYCLE + 1).effect)).toEqual([
      'scatter',
      'wave',
      'shuffle',
      'vortex',
    ]);
    expect(wordPhase(WORD_EFFECTS.length * WORD_CYCLE + 1).effect).toBe('scatter');
    expect(wordPhase(-5)).toEqual(wordPhase(0));
  });

  it('runs every change from left to right', () => {
    expect(dotProgress(0.5, 0)).toBeGreaterThan(dotProgress(0.5, 1));
    expect(dotProgress(0, 0)).toBe(0);
    expect(dotProgress(1, 1)).toBe(1);
    expect(dotProgress(1, 0)).toBe(1);
  });

  it('every change starts and ends on the word', () => {
    expect(outAndBack(0)).toBe(0);
    expect(outAndBack(0.5)).toBe(1);
    expect(outAndBack(1)).toBe(0);
    expect(outAndBack(0.25)).toBeCloseTo(0.5);
  });

  it('a shuffle moves every dot to a place, none left empty, the same way each time', () => {
    const order = seededShuffle(200, 3);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 200 }, (_, i) => i));
    expect(seededShuffle(200, 3)).toEqual(order);
    expect(seededShuffle(200, 4)).not.toEqual(order);
  });

  it('scatters into a cloud inside the mark', () => {
    const cloud = seededCloud(300, 2);
    expect(cloud).toHaveLength(300);
    for (const p of cloud) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(1);
    expect(seededCloud(300, 2)).toEqual(cloud);
  });

  it('eases in and out', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(2)).toBe(1);
  });
});
