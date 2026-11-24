/**
 * The geometry and colour arithmetic behind the MeroAI orb (ADR-078). Pure, so it is tested
 * without a canvas.
 */

export type Vec3 = { x: number; y: number; z: number };
export type Rgb = { r: number; g: number; b: number };

/**
 * `count` points spread evenly over a unit sphere (the Fibonacci lattice): no clumps at the
 * poles, which a random spread would give, so the shell reads as a smooth surface.
 */
export function fibonacciSphere(count: number): Vec3[] {
  const points: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (index / Math.max(1, count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * index;
    points.push({ x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius });
  }
  return points;
}

/** Turns a point about the vertical axis, then tilts it towards the viewer. */
export function rotate(point: Vec3, yaw: number, tilt: number): Vec3 {
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const x = point.x * cosY + point.z * sinY;
  const z1 = -point.x * sinY + point.z * cosY;
  const cosX = Math.cos(tilt);
  const sinX = Math.sin(tilt);
  return { x, y: point.y * cosX - z1 * sinX, z: point.y * sinX + z1 * cosX };
}

/** How many particles suit an orb of `size` CSS pixels: dense enough to read, light to draw. */
export function particleCount(size: number): number {
  return Math.round(Math.min(1100, Math.max(70, size * size * 0.12)));
}

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

export const easeInOutCubic = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
};

/** One loop of the orb: a turning sphere, the word forming, held, then the sphere again. */
export const MORPH_TIMELINE = { sphere: 3.2, form: 2, hold: 2.4, release: 1.6 } as const;
export const MORPH_CYCLE =
  MORPH_TIMELINE.sphere + MORPH_TIMELINE.form + MORPH_TIMELINE.hold + MORPH_TIMELINE.release;

/**
 * Where the loop is at `seconds`: how far the word has formed (0 = sphere, 1 = word), and whether
 * it is forming or coming apart, which decides the order the dots move in.
 */
export function morphState(seconds: number): { amount: number; forming: boolean } {
  const t = ((seconds % MORPH_CYCLE) + MORPH_CYCLE) % MORPH_CYCLE;
  const { sphere, form, hold } = MORPH_TIMELINE;
  if (t < sphere) return { amount: 0, forming: true };
  if (t < sphere + form) return { amount: (t - sphere) / form, forming: true };
  if (t < sphere + form + hold) return { amount: 1, forming: true };
  return { amount: 1 - (t - sphere - form - hold) / MORPH_TIMELINE.release, forming: false };
}

/**
 * One dot's share of the loop's progress, staggered by where it lands: the word writes itself
 * from left to right, and comes apart in the same direction. `place` runs from 0 (left) to 1.
 */
export function staggered(amount: number, place: number, forming: boolean, spread = 0.45): number {
  const delay = place * spread;
  return forming
    ? easeInOutCubic((amount - delay) / (1 - spread))
    : 1 - easeInOutCubic((1 - amount - delay) / (1 - spread));
}
