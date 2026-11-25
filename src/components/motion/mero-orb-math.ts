/**
 * The geometry, timing and colour arithmetic behind MeroAI's mark (ADR-078, ADR-086): a sphere
 * of dots that swirls into the word "meroAI", resolves into the typed word, and goes back again.
 * Pure, so it is tested without a canvas.
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

/** From this height up the mark is square, with room for the word across it. */
const SQUARE_FROM = 64;

/**
 * How wide the mark is for its height. A small mark is as wide as the word, so the letters get
 * the whole height instead of a sliver of a square.
 */
export function markWidth(size: number): number {
  return size >= SQUARE_FROM ? size : Math.round(size * 2.6);
}

/**
 * How many dots write the word, from the letters' inked area in CSS pixels: spaced so the letters
 * stay dotted on a large mark, and packed tighter on a small one, where they would break up.
 */
export function wordDotCount(inkedArea: number, size: number): number {
  const spacing = Math.max(1.1, size / 60);
  return Math.round(Math.min(1400, Math.max(60, inkedArea / (spacing * spacing))));
}

export const easeInOutCubic = (t: number) => {
  const c = clamp01(t);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
};

/**
 * One loop of the mark, in seconds: the turning sphere; its dots swirling into the letters; a
 * scan line resolving the dots into the typed word; the word held; the scan line breaking it back
 * into dots; and the dots returning to the sphere.
 */
export const LOGO_TIMELINE = {
  sphere: 1.1,
  form: 1.5,
  resolve: 0.5,
  hold: 2.2,
  dissolve: 0.5,
  release: 1.3,
} as const;
export type LogoStage = keyof typeof LOGO_TIMELINE;
const STAGES = Object.keys(LOGO_TIMELINE) as LogoStage[];
export const LOGO_CYCLE = STAGES.reduce((total, stage) => total + LOGO_TIMELINE[stage], 0);

/** Where the loop is at `seconds`: the stage, and how far through it (0 to 1). */
export function logoPhase(seconds: number): { stage: LogoStage; t: number } {
  let into = ((seconds % LOGO_CYCLE) + LOGO_CYCLE) % LOGO_CYCLE;
  for (const stage of STAGES) {
    const length = LOGO_TIMELINE[stage];
    if (into < length) return { stage, t: into / length };
    into -= length;
  }
  return { stage: 'sphere', t: 0 };
}

/**
 * One dot's share of a flight, staggered by where it lands so the word writes itself from left
 * to right, and comes apart in the same direction. `place` runs from 0 (left) to 1.
 */
export function staggered(t: number, place: number, spread = 0.45): number {
  return easeInOutCubic((t - clamp01(place) * spread) / (1 - spread));
}
