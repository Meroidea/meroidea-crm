/**
 * The geometry, timing and colour arithmetic behind MeroAI's mark (ADR-078, ADR-080, ADR-085):
 * dots that always spell "meroAI" and keep changing how they do it. Pure, so it is tested without
 * a canvas.
 */

export type Rgb = { r: number; g: number; b: number };

/** "#4b49ac" or "rgb(75, 73, 172)" (what a canvas reports back) as numbers; null otherwise. */
export function parseRgb(value: string): Rgb | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex?.[1]) {
    const number = Number.parseInt(hex[1], 16);
    return { r: (number >> 16) & 255, g: (number >> 8) & 255, b: number & 255 };
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(value.trim());
  return rgb ? { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) } : null;
}

/** `a` blended towards `b` by `amount` (0 = all a, 1 = all b). */
export function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  const t = Math.min(1, Math.max(0, amount));
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

export const rgba = (color: Rgb, alpha: number) =>
  `rgba(${color.r}, ${color.g}, ${color.b}, ${Math.min(1, Math.max(0, alpha))})`;

/** Smooth, never-quite-repeating wobble from a few sines: enough for flowing ribbons. */
export function wobble(a: number, b: number): number {
  return (
    (Math.sin(a * 1.7 + b) +
      Math.sin(a * 0.9 - b * 1.3) * 0.6 +
      Math.sin(a * 2.3 + b * 0.7) * 0.3) /
    1.9
  );
}

export type Point2 = { x: number; y: number };

/** A small seeded generator, so the same word always gives the same dots. */
function seeded(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4_294_967_296;
  };
}

/**
 * `count` points inside the opaque pixels of a mask (text drawn on a canvas), centred and scaled
 * so x runs from -1 to 1 across the mask's width, y on the same scale. Picked in a scattered but
 * repeatable order, so the dots fill the letters evenly instead of in rows; when the letters have
 * fewer pixels than dots, points repeat with a little jitter. Sorted left to right.
 */
export function sampleMask(
  mask: { width: number; height: number; data: ArrayLike<number> },
  count: number,
): Point2[] {
  const half = mask.width / 2;
  const inked: Point2[] = [];
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if ((mask.data[(y * mask.width + x) * 4 + 3] ?? 0) >= 128) {
        inked.push({ x: (x + 0.5 - half) / half, y: (y + 0.5 - mask.height / 2) / half });
      }
    }
  }
  if (inked.length === 0 || count <= 0) return [];
  const random = seeded(inked.length * 31 + count);
  for (let index = inked.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [inked[index], inked[swap]] = [inked[swap]!, inked[index]!];
  }
  const jitter = 0.6 / half;
  const points = Array.from({ length: count }, (_, index) => {
    const point = inked[index % inked.length]!;
    return index < inked.length
      ? point
      : { x: point.x + (random() - 0.5) * jitter, y: point.y + (random() - 0.5) * jitter };
  });
  return points.sort((a, b) => a.x - b.x || a.y - b.y);
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * How many dots write the word, from the letters' inked area in CSS pixels: spaced so the letters
 * stay dotted on a large mark, and packed tighter on a small one, where they would break up.
 */
export function wordDotCount(inkedArea: number, size: number): number {
  const spacing = Math.max(1.1, size / 60);
  return Math.round(Math.min(1400, Math.max(60, inkedArea / (spacing * spacing))));
}

/**
 * The ways the dots rework the word, one after another, each starting and ending on the word:
 * - scatter: the dots burst into a cloud and swirl back;
 * - wave: a swell lifts the letters, travelling from left to right;
 * - shuffle: every dot flies to another dot's place, so the letters dissolve and knit again;
 * - vortex: the word winds into a spiral at the centre and unwinds.
 */
export const WORD_EFFECTS = ['scatter', 'wave', 'shuffle', 'vortex'] as const;
export type WordEffect = (typeof WORD_EFFECTS)[number];

/** One loop: the word held (still alive, never frozen), then one change. */
export const WORD_TIMELINE = { hold: 3.2, change: 2.4 } as const;
export const WORD_CYCLE = WORD_TIMELINE.hold + WORD_TIMELINE.change;

/** Where the loop is at `seconds`: which change, and how far through it (0 while held). */
export function wordPhase(seconds: number): {
  cycle: number;
  effect: WordEffect;
  progress: number;
} {
  const time = Math.max(0, seconds);
  const cycle = Math.floor(time / WORD_CYCLE);
  const into = time - cycle * WORD_CYCLE;
  return {
    cycle,
    effect: WORD_EFFECTS[cycle % WORD_EFFECTS.length]!,
    progress: into < WORD_TIMELINE.hold ? 0 : (into - WORD_TIMELINE.hold) / WORD_TIMELINE.change,
  };
}

/**
 * One dot's progress through a change, staggered by where it sits in the word so every change
 * runs from left to right. `place` runs from 0 (left) to 1.
 */
export function dotProgress(progress: number, place: number, spread = 0.35): number {
  if (progress <= 0) return 0;
  return clamp01((progress - clamp01(place) * spread) / (1 - spread));
}

export const easeInOutCubic = (t: number) => {
  const c = clamp01(t);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
};

/** Out and home again: 0 at the word, 1 at the far point, then 0, eased both ways. */
export function outAndBack(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  return t < 0.5 ? easeInOutCubic(t * 2) : easeInOutCubic((1 - t) * 2);
}

/** A repeatable shuffle of 0..count-1: the same seed always gives the same order. */
export function seededShuffle(count: number, seed: number): number[] {
  const random = seeded(seed * 7919 + count);
  const order = Array.from({ length: count }, (_, index) => index);
  for (let index = count - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [order[index], order[swap]] = [order[swap]!, order[index]!];
  }
  return order;
}

/** `count` repeatable points spread evenly over the unit disc, for the scatter cloud. */
export function seededCloud(count: number, seed: number): Point2[] {
  const random = seeded(seed * 104_729 + count);
  return Array.from({ length: count }, () => {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random());
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}
