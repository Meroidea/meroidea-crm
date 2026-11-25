'use client';

import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

import {
  easeInOutCubic,
  fibonacciSphere,
  LOGO_TIMELINE,
  logoPhase,
  markWidth,
  parseRgb,
  rgba,
  rotate,
  sampleMask,
  staggered,
  wordDotCount,
  type Point2,
  type Rgb,
} from './mero-orb-math';

export type MeroOrbState = 'idle' | 'thinking';

/**
 * MeroAI's ink (the `--meroai-ink` token) as numbers, read the way the browser resolves it. The
 * mark is monochrome on purpose: the same in every business, on whatever is behind it.
 */
function inkColour(element: Element): Rgb {
  const raw = getComputedStyle(element).getPropertyValue('--meroai-ink').trim();
  const probe = document.createElement('canvas').getContext('2d');
  if (!raw || !probe) return { r: 10, g: 10, b: 10 };
  probe.fillStyle = raw;
  return parseRgb(String(probe.fillStyle)) ?? { r: 10, g: 10, b: 10 };
}

const WORD = 'meroAI';

/**
 * The typed word and the dots that write it. The word is drawn on a scratch canvas in the page's
 * own font and its letters sampled (sampleMask), so each dot lands inside the very letters the
 * word is later typed in. Returns the dots in mark units (x from -1 to 1 across the writing
 * width) and the CSS font that types the same word at the mark's scale.
 */
function wordGeometry(width: number, fontFamily: string): { points: Point2[]; font: string } {
  const scale = Math.max(1, 120 / width);
  const scratchWidth = Math.round(width * 2 * scale);
  const scratchHeight = Math.round(width * 0.8 * scale);
  const scratch = document.createElement('canvas');
  scratch.width = scratchWidth;
  scratch.height = scratchHeight;
  const context = scratch.getContext('2d', { willReadFrequently: true });
  if (!context) return { points: [], font: '' };
  const weight = width < 96 ? 700 : 650;
  let fontSize = scratchHeight * 0.8;
  context.font = `${weight} ${fontSize}px ${fontFamily}`;
  fontSize *= Math.min(1, (scratchWidth * 0.94) / context.measureText(WORD).width);
  context.font = `${weight} ${fontSize}px ${fontFamily}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#000';
  context.fillText(WORD, scratchWidth / 2, scratchHeight / 2);
  const mask = context.getImageData(0, 0, scratchWidth, scratchHeight);
  let inked = 0;
  for (let index = 3; index < mask.data.length; index += 4) {
    if (mask.data[index]! >= 128) inked += 1;
  }
  // One scratch pixel is 0.47 / scale mark pixels: the writing spans 94% of the mark's width.
  return {
    points: sampleMask(mask, wordDotCount(inked / (scale * scale), width)),
    font: `${weight} ${(fontSize * 0.47) / scale}px ${fontFamily}`,
  };
}

/**
 * MeroAI's mark. A turning sphere of black dots swirls out into the letters of "meroAI"; a thin
 * scan line passes over them and leaves the word typed, solid and crisp; the word holds, the scan
 * line breaks it back into dots, and they return to the sphere. About seven seconds a loop, on a
 * transparent ground, so it sits on the page's own background. While MeroAI works, the sphere
 * spins faster with a band of light across it, and the word waits until the work is done.
 * Decorative: the words around it, or the button it sits in, carry the meaning.
 *
 * Drawn on a plain canvas, no library. It pauses when off screen or in a background tab, and is
 * the typed word, still, for people who ask for reduced motion.
 */
export function MeroOrb({
  size = 32,
  state = 'idle',
  className,
}: {
  /** The mark's height in pixels; below 64 it is as wide as the word (`markWidth`). */
  size?: number;
  state?: MeroOrbState;
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

    const width = markWidth(size);
    const height = size;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const INK = inkColour(canvas);
    const cx = width / 2;
    const cy = height / 2;
    const radius = height * 0.44;
    const writing = width * 0.47;
    // On a wide mark the dots travel sideways; their swirl stays inside its height.
    const squash = Math.min(1, height / width);
    const dot = Math.max(0.55, width / 150);

    let word: Point2[] = [];
    let font = '';
    let sphere: ReturnType<typeof fibonacciSphere> = [];
    let left = 0;
    let right = 0;
    // Which letter dot each sphere dot becomes: settled as each loop leaves the sphere, by where
    // the dots are then, so the left of the sphere writes the "m".
    let slot: number[] = [];
    let wasSphere = true;

    let yaw = 0;
    let energy = stateRef.current === 'thinking' ? 1 : 0;
    let clock = 0;
    let logoClock = LOGO_TIMELINE.sphere * 0.4;
    let last = performance.now();
    let frame = 0;
    let running = false;
    let cancelled = false;

    const typeWord = (from: number, to: number) => {
      if (to <= from) return;
      context.save();
      context.beginPath();
      context.rect(from, 0, to - from, height);
      context.clip();
      context.font = font;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = rgba(INK, 1);
      context.fillText(WORD, cx, cy);
      context.restore();
    };

    const scanLine = (x: number, strength: number) => {
      const top = cy - height * 0.36;
      const bottom = cy + height * 0.36;
      const gradient = context.createLinearGradient(0, top, 0, bottom);
      gradient.addColorStop(0, rgba(INK, 0));
      gradient.addColorStop(0.5, rgba(INK, 0.55 * strength));
      gradient.addColorStop(1, rgba(INK, 0));
      context.fillStyle = gradient;
      context.fillRect(x - 0.5, top, 1, bottom - top);
    };

    const disc = (x: number, y: number, r: number, alpha: number) => {
      if (alpha <= 0.01) return;
      context.fillStyle = rgba(INK, alpha);
      context.beginPath();
      context.arc(x, y, r, 0, Math.PI * 2);
      context.fill();
    };

    const draw = (still = false) => {
      context.clearRect(0, 0, width, height);
      if (word.length === 0) return;
      if (still) {
        typeWord(0, width);
        return;
      }
      const { stage, t } = logoPhase(logoClock);
      const sweep = Math.sin(clock * 2.2);
      const projected = sphere.map((base) => {
        const p = rotate(base, yaw, 0.32);
        return { x: cx + p.x * radius, y: cy + p.y * radius, facing: p.z };
      });

      if (stage === 'sphere') {
        wasSphere = true;
      } else if (wasSphere) {
        wasSphere = false;
        const order = projected
          .map((_, index) => index)
          .sort((a, b) => projected[a]!.x - projected[b]!.x);
        slot = new Array<number>(projected.length);
        order.forEach((dotIndex, position) => {
          slot[dotIndex] = position;
        });
      }

      if (stage === 'hold') {
        typeWord(0, width);
        return;
      }

      // The scan line runs a little past the letters on both sides, so it enters and leaves.
      const scan = left - dot * 4 + (right - left + dot * 8) * easeInOutCubic(t);
      const fade = Math.max(2, width * 0.04);
      if (stage === 'resolve') typeWord(0, scan);
      if (stage === 'dissolve') typeWord(scan, width);

      for (let index = 0; index < projected.length; index += 1) {
        const from = projected[index]!;
        const sphereAlpha = from.facing > 0.02 ? 0.45 + from.facing * 0.55 : 0;
        const sphereSize = dot * (0.6 + Math.max(0, from.facing) * 0.7);

        if (stage === 'sphere') {
          if (from.facing <= 0.02) continue;
          const glow = energy * Math.max(0, 1 - Math.abs((from.y - cy) / radius - sweep) * 2.5);
          disc(
            from.x,
            from.y,
            sphereSize * (1 + glow * 0.4),
            Math.min(1, sphereAlpha + glow * 0.5),
          );
          continue;
        }

        const target = word[slot[index] ?? index]!;
        const tx = cx + target.x * writing;
        const ty = cy + target.y * writing;

        if (stage === 'resolve' || stage === 'dissolve') {
          // Ahead of the line in "resolve", behind it in "dissolve": still dots, fading at the line.
          const distance = stage === 'resolve' ? tx - scan : scan - tx;
          disc(tx, ty, dot, Math.max(0, Math.min(1, distance / fade)) * 0.95);
          continue;
        }

        const place = (target.x + 1) / 2;
        // 0 on the sphere, 1 in the letter.
        const k = stage === 'form' ? staggered(t, place) : 1 - staggered(t, place);
        const lift = Math.sin(Math.PI * k);
        const dx = tx - from.x;
        const dy = ty - from.y;
        const swirl = (index % 2 === 0 ? 1 : -1) * lift * 0.35;
        disc(
          from.x + dx * k - dy * swirl,
          from.y + dy * k + dx * swirl * squash,
          sphereSize + (dot - sphereSize) * k + lift * dot * 0.5,
          sphereAlpha + (0.95 - sphereAlpha) * k,
        );
      }

      if (stage === 'resolve' || stage === 'dissolve') scanLine(scan, Math.sin(Math.PI * t));
    };

    const tick = (now: number) => {
      const seconds = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = stateRef.current === 'thinking' ? 1 : 0;
      energy += (target - energy) * Math.min(1, seconds * 3);
      clock += seconds;
      // While MeroAI works the mark rests as the spinning sphere: a word already out finishes its
      // loop first.
      if (target === 0 || logoPhase(logoClock).stage !== 'sphere') logoClock += seconds;
      yaw += seconds * (0.35 + energy * 1.2);
      draw();
      frame = requestAnimationFrame(tick);
    };

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const start = () => {
      if (running || reduced.matches || document.hidden || word.length === 0) return;
      running = true;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    let visible = true;
    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      if (visible) start();
      else stop();
    });
    const onVisibility = () => (document.hidden || !visible ? stop() : start());
    const onMotion = () => (reduced.matches ? (stop(), draw(true)) : start());

    // The word is laid out once the page's font has loaded, so the letters are the brand's own.
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      const geometry = wordGeometry(width, getComputedStyle(canvas).fontFamily || 'sans-serif');
      word = geometry.points;
      font = geometry.font;
      sphere = fibonacciSphere(word.length);
      const xs = word.map((point) => cx + point.x * writing);
      left = Math.min(...xs);
      right = Math.max(...xs);
      draw(reduced.matches);
      observer.observe(canvas);
      document.addEventListener('visibilitychange', onVisibility);
      reduced.addEventListener('change', onMotion);
      start();
    });

    return () => {
      cancelled = true;
      stop();
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener('change', onMotion);
    };
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn('shrink-0', className)}
      style={{ width: markWidth(size), height: size }}
    />
  );
}
