'use client';

import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

import {
  fibonacciSphere,
  morphState,
  parseRgb,
  particleCount,
  rgba,
  rotate,
  sampleMask,
  staggered,
  type Point2,
  type Rgb,
} from './mero-orb-math';

export type MeroOrbState = 'idle' | 'thinking';

/**
 * MeroAI's ink (the `--meroai-ink` token) as numbers, read the way the browser resolves it. The
 * orb is monochrome on purpose: the same dots in every business, on whatever is behind them.
 */
function inkColour(element: Element): Rgb {
  const raw = getComputedStyle(element).getPropertyValue('--meroai-ink').trim();
  const probe = document.createElement('canvas').getContext('2d');
  if (!raw || !probe) return { r: 10, g: 10, b: 10 };
  probe.fillStyle = raw;
  return parseRgb(String(probe.fillStyle)) ?? { r: 10, g: 10, b: 10 };
}
const WORD = 'meroAI';
/** Below this the word would be a smudge, so a small orb stays a sphere. */
const WORD_MIN_SIZE = 64;

/**
 * The word's dots, from the page's own font drawn on a scratch canvas and sampled (sampleMask).
 * In orb units: x from -1 to 1 across the disc's writing width.
 */
function wordPoints(size: number, count: number, fontFamily: string): Point2[] {
  const width = Math.round(size * 2);
  const height = Math.round(size * 0.8);
  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const context = scratch.getContext('2d', { willReadFrequently: true });
  if (!context) return [];
  // Fit the word to the width, then draw it centred.
  let fontSize = height * 0.8;
  context.font = `700 ${fontSize}px ${fontFamily}`;
  const measured = context.measureText(WORD).width;
  fontSize *= Math.min(1, (width * 0.94) / measured);
  context.font = `700 ${fontSize}px ${fontFamily}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#000';
  context.fillText(WORD, width / 2, height / 2);
  return sampleMask(context.getImageData(0, 0, width, height), count);
}

/**
 * The MeroAI orb: a sphere of evenly spaced black dots on a transparent ground, so it sits on the
 * page's own background, seen from the front, its dots foreshortened towards the rim. On an orb
 * large enough to read, the dots regularly leave the sphere, swirl out and write "meroAI" from
 * left to right, hold it with a twinkle, then fly back to the turning sphere. While MeroAI works,
 * the sphere spins faster and a band of light sweeps across it, and the word waits. Decorative:
 * the words around it carry the meaning.
 *
 * Drawn on a plain canvas, no library. It pauses when off screen or in a background tab, and
 * draws one still frame of the sphere for people who ask for reduced motion.
 */
export function MeroOrb({
  size = 32,
  state = 'idle',
  morph = size >= WORD_MIN_SIZE,
  className,
}: {
  size?: number;
  state?: MeroOrbState;
  /** Whether the dots write "meroAI" between turns; on by default when the orb is big enough. */
  morph?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Read by the running animation without restarting it when the state changes.
  const stateRef = useRef<MeroOrbState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const DOT = inkColour(canvas);
    const points = fibonacciSphere(particleCount(size));
    const center = size / 2;
    const radius = size * 0.46;
    // Black on a light page needs bolder dots than white on black did, most of all when small.
    const dot = Math.max(0.75, size / 150);
    const writing = size * 0.47;

    // The word is sampled once the page's font has loaded, so the letters are the brand's own.
    let word: Point2[] | null = null;
    if (morph) {
      void document.fonts.ready.then(() => {
        word = wordPoints(size, points.length, getComputedStyle(canvas).fontFamily || 'sans-serif');
      });
    }
    // Which dot goes to which letter: settled when each loop starts, by where the dots are then,
    // so the leftmost dots write the "m" and the sphere unspools sideways into the word.
    let order: number[] = [];
    let slot: number[] = [];
    let wasSphere = true;

    let yaw = 0;
    let energy = stateRef.current === 'thinking' ? 1 : 0;
    let clock = 0;
    let wordClock = 0;
    let last = performance.now();
    let frame = 0;
    let running = false;

    const draw = () => {
      context.clearRect(0, 0, size, size);

      const tilt = 0.32;
      const sweep = Math.sin(clock * 2.2);
      const loop = word && word.length ? morphState(wordClock) : { amount: 0, forming: true };

      const projected = points.map((base) => {
        const p = rotate(base, yaw, tilt);
        return { x: center + p.x * radius, y: center + p.y * radius, facing: p.z };
      });

      if (loop.amount === 0) {
        wasSphere = true;
      } else if (wasSphere && word) {
        wasSphere = false;
        order = projected
          .map((_, index) => index)
          .sort((a, b) => projected[a]!.x - projected[b]!.x);
        slot = new Array<number>(points.length);
        order.forEach((dotIndex, position) => {
          slot[dotIndex] = position;
        });
      }

      for (let index = 0; index < projected.length; index += 1) {
        const from = projected[index]!;
        const target = loop.amount > 0 && word ? word[slot[index] ?? 0] : undefined;
        if (!target) {
          // Only the near half of the sphere shows, as on a solid globe.
          if (from.facing <= 0.02) continue;
          const glow =
            energy * Math.max(0, 1 - Math.abs(from.y / radius - center / radius - sweep) * 2.5);
          context.fillStyle = rgba(DOT, Math.min(1, 0.5 + from.facing * 0.5 + glow * 0.5));
          context.beginPath();
          context.arc(
            from.x,
            from.y,
            dot * (0.55 + from.facing * 0.75 + glow * 0.4),
            0,
            Math.PI * 2,
          );
          context.fill();
          continue;
        }

        const place = (target.x + 1) / 2;
        const t = staggered(loop.amount, place, loop.forming);
        const to = { x: center + target.x * writing, y: center + target.y * writing };
        // A swirl on the way: each dot arcs out and round, the further it travels the wider.
        const lift = Math.sin(Math.PI * t);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const swirl = (index % 2 === 0 ? 1 : -1) * lift * 0.35;
        const x = from.x + dx * t - dy * swirl;
        const y = from.y + dy * t + dx * swirl;
        // Dots from the far side fade in as they come round; held letters twinkle softly.
        const sphereAlpha = from.facing > 0.02 ? 0.5 + from.facing * 0.5 : 0;
        const twinkle = 0.85 + 0.15 * Math.sin(clock * 3 + index * 1.7);
        const alpha = sphereAlpha + (twinkle - sphereAlpha) * t;
        const sphereSize = dot * (0.55 + Math.max(0, from.facing) * 0.75);
        const letterSize = dot * 0.7;
        context.fillStyle = rgba(DOT, alpha);
        context.beginPath();
        context.arc(
          x,
          y,
          sphereSize + (letterSize - sphereSize) * t + lift * dot * 0.6,
          0,
          Math.PI * 2,
        );
        context.fill();
      }
    };

    const tick = (now: number) => {
      const seconds = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = stateRef.current === 'thinking' ? 1 : 0;
      energy += (target - energy) * Math.min(1, seconds * 3);
      clock += seconds;
      // While MeroAI works, the word waits: the loop runs on only once a written word is undone.
      const loop = morphState(wordClock);
      if (target === 0 || loop.amount > 0) wordClock += seconds;
      yaw += seconds * (0.22 + energy * 1.2);
      draw();
      frame = requestAnimationFrame(tick);
    };

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const start = () => {
      if (running || reduced.matches || document.hidden) return;
      running = true;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    draw();
    let visible = true;
    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      if (visible) start();
      else stop();
    });
    observer.observe(canvas);
    const onVisibility = () => (document.hidden || !visible ? stop() : start());
    const onMotion = () => (reduced.matches ? (stop(), draw()) : start());
    document.addEventListener('visibilitychange', onVisibility);
    reduced.addEventListener('change', onMotion);
    start();

    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener('change', onMotion);
    };
  }, [size, morph]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn('shrink-0 rounded-full', className)}
      style={{ width: size, height: size }}
    />
  );
}
