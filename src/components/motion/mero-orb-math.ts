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
