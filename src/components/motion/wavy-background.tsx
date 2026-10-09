'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

type WavyBackgroundProps = {
  children: ReactNode;
  className?: string;
  containerClassName?: string;
  /** CSS colours or theme variables; defaults to the brand chart palette. */
  colors?: string[];
  waveWidth?: number;
  speed?: 'slow' | 'fast';
  waveOpacity?: number;
  /** How many lines to draw; colours cycle through the palette. */
  lines?: number;
};

const DEFAULT_COLORS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--info'];

/** Resolves `--token` names against the page's theme so tenant/brand colours carry through. */
function resolveColor(value: string): string {
  if (!value.startsWith('--')) return value;
  return getComputedStyle(document.documentElement).getPropertyValue(value).trim() || '#4b49ac';
}

/** Small seeded PRNG, so each page load gets its own pattern. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 2D gradient (Perlin) noise, roughly -1…1. Smooth but never repeating, which is what makes the
 * lines feel alive rather than looping; small enough not to justify a dependency.
 */
function createNoise(random: () => number) {
  const perm = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [base[i], base[j]] = [base[j] ?? 0, base[i] ?? 0];
  }
  for (let i = 0; i < 512; i += 1) perm[i] = base[i & 255] ?? 0;

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (hash: number, x: number, y: number) => {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };

  return (x: number, y: number) => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[(perm[xi] ?? 0) + yi] ?? 0;
    const ab = perm[(perm[xi] ?? 0) + yi + 1] ?? 0;
    const ba = perm[(perm[xi + 1] ?? 0) + yi] ?? 0;
    const bb = perm[(perm[xi + 1] ?? 0) + yi + 1] ?? 0;
    const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
    const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
    return (x1 + v * (x2 - x1)) * 0.7;
  };
}

/** Each line's own character: where it samples the noise, how fast, how wide, how bold. */
type LinePersonality = {
  offset: number;
  frequency: number;
  speed: number;
  amplitude: number;
  gustSeed: number;
  width: number;
  alpha: number;
};

function createPersonalities(count: number, random: () => number): LinePersonality[] {
  return Array.from({ length: count }, () => ({
    offset: random() * 1000,
    frequency: 0.0011 + random() * 0.0026,
    // Some lines drift the other way, so the field never moves as one block.
    speed: (0.45 + random() * 1.2) * (random() < 0.3 ? -1 : 1),
    amplitude: 0.55 + random() * 0.95,
    gustSeed: random() * 500,
    width: 0.6 + random() * 0.8,
    alpha: 0.45 + random() * 0.55,
  }));
}

/**
 * Animated flowing lines behind hero text, each with its own random character. Transparent over the page background, paused when
 * off-screen or in a hidden tab, and drawn once without motion for prefers-reduced-motion.
 */
export function WavyBackground({
  children,
  className,
  containerClassName,
  colors = DEFAULT_COLORS,
  waveWidth = 3,
  speed = 'slow',
  waveOpacity = 0.085,
  lines = 32,
}: WavyBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !container || !context) return;

    const palette = colors.map(resolveColor);
    const step = speed === 'fast' ? 0.0022 : 0.0009;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let time = 0;
    let frame = 0;
    let visible = true;

    const resize = () => {
      // One canvas pixel per CSS pixel, even on high-density screens: the lines are soft by
      // design, and a full-density canvas this wide costs four times the fill for no visible gain.
      const ratio = 1;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const random = mulberry32(Math.floor(Math.random() * 2 ** 32));
    const noise = createNoise(random);
    const personalities = createPersonalities(lines, random);

    const draw = () => {
      context.clearRect(0, 0, width, height);
      context.lineCap = 'round';
      const baseWidth = width < 640 ? Math.max(1.2, waveWidth * 0.7) : waveWidth;
      const amplitude = Math.min(height * 0.12, 70);
      // Lanes span most of the canvas height in the middle and pinch together towards the left
      // and right edges, so the lines gather slightly at the sides instead of running as a flat band.
      const spread = (height * 0.82) / lines;
      // Narrow screens have no room for a lens; pinch only gently there.
      const floor = width < 640 ? 0.6 : 0.55;
      const pinch = (x: number) => {
        const t = Math.min(1, Math.max(0, x / width));
        return floor + (1 - floor) * Math.sin(Math.PI * t);
      };

      personalities.forEach((line, index) => {
        // Slow "gusts" swell and calm each line on its own schedule; its lane wanders too, so
        // lines now and then cross their neighbours instead of keeping a fixed order.
        const gust = 0.35 + 0.95 * (noise(time * 0.12, line.gustSeed) * 0.5 + 0.5);
        const lane =
          (index - (lines - 1) / 2) * spread + noise(time * 0.07, line.gustSeed + 31) * spread * 3;
        const edge = Math.abs(index - (lines - 1) / 2) / ((lines - 1) / 2);

        context.globalAlpha = waveOpacity * line.alpha * (0.4 + 0.6 * edge) * (0.6 + 0.4 * gust);
        context.lineWidth = baseWidth * line.width;
        context.strokeStyle = palette[index % palette.length] ?? '#4b49ac';
        context.beginPath();
        for (let x = -20; x <= width + 20; x += 10) {
          const envelope = pinch(x);
          const t = time * line.speed;
          const wave =
            noise(x * line.frequency + line.offset, t) +
            0.45 * noise(x * line.frequency * 2.3 + line.offset * 1.7, t * 1.6 + 50);
          const y =
            wave * amplitude * line.amplitude * gust * (0.45 + 0.55 * envelope) +
            height * 0.5 +
            lane * envelope;
          if (x === -20) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      });
    };

    // The lines drift slowly, so they are redrawn on every other frame (~30 a second), leaving
    // the frames in between free for scrolling.
    let skip = false;
    const tick = () => {
      frame = 0;
      if (!visible || document.hidden) return;
      skip = !skip;
      if (!skip) {
        time += step * 32;
        draw();
      }
      frame = requestAnimationFrame(tick);
    };

    // Paint a frame straight away so the waves show even before (or without) animation.
    const start = () => {
      draw();
      if (!reduced && !frame) frame = requestAnimationFrame(tick);
    };

    resize();
    start();

    const resizeObserver = new ResizeObserver(() => {
      resize();
      draw();
    });
    resizeObserver.observe(container);

    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible) start();
    });
    intersection.observe(container);

    const onVisibility = () => {
      if (!document.hidden) start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [colors, speed, waveOpacity, waveWidth, lines]);

  return (
    <div ref={containerRef} className={cn('relative isolate', containerClassName)}>
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-12 -z-10 h-[calc(100%+6rem)] w-full [mask-image:linear-gradient(to_bottom,transparent,black_14%,black_86%,transparent)]"
      />
      <div className={className}>{children}</div>
    </div>
  );
}
