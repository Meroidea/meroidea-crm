'use client';

import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

import {
  dotProgress,
  easeInOutCubic,
  markWidth,
  outAndBack,
  parseRgb,
  rgba,
  sampleMask,
  seededCloud,
  seededShuffle,
  WORD_TIMELINE,
  wobble,
  wordDotCount,
  wordPhase,
  type Point2,
  type Rgb,
} from './mero-orb-math';

export type MeroOrbState = 'idle' | 'thinking';

/**
 * MeroAI's ink (the `--meroai-ink` token) as numbers, read the way the browser resolves it. The
 * mark is monochrome on purpose: the same dots in every business, on whatever is behind them.
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
 * The word's dots, from the page's own font drawn on a scratch canvas and sampled (sampleMask).
 * In mark units: x from -1 to 1 across the writing width. A small mark is drawn larger on the
 * scratch canvas, so its thin strokes still give clean letters to sample.
 */
function wordPoints(size: number, fontFamily: string): Point2[] {
  const scale = Math.max(1, 120 / size);
  const width = Math.round(size * 2 * scale);
  const height = Math.round(size * 0.8 * scale);
  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const context = scratch.getContext('2d', { willReadFrequently: true });
  if (!context) return [];
  // Heavier letters on a small mark, where a regular stroke is under a pixel wide.
  const weight = size < 96 ? 800 : 700;
  let fontSize = height * 0.8;
  context.font = `${weight} ${fontSize}px ${fontFamily}`;
  fontSize *= Math.min(1, (width * 0.94) / context.measureText(WORD).width);
  context.font = `${weight} ${fontSize}px ${fontFamily}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#000';
  context.fillText(WORD, width / 2, height / 2);
  const mask = context.getImageData(0, 0, width, height);
  let inked = 0;
  for (let index = 3; index < mask.data.length; index += 4)
    if (mask.data[index]! >= 128) inked += 1;
  return sampleMask(mask, wordDotCount(inked / (scale * scale), size));
}

/**
 * MeroAI's mark: the word "meroAI" written in black dots on a transparent ground, so it sits on
 * the page's own background. The word is always there and never still. Each dot fizzes about its
 * place, a glint runs along the letters, and every few seconds the dots rework the word: they
 * burst into a cloud and swirl back, ride a wave across it, swap places so the letters dissolve
 * and knit again, or wind into a spiral and unwind (WORD_EFFECTS). While MeroAI works, the dots
 * move faster and the changes come sooner. Decorative: the words around it carry the meaning.
 *
 * Drawn on a plain canvas, no library. It pauses when off screen or in a background tab, and
 * draws the word once, still, for people who ask for reduced motion.
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

    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = markWidth(size);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(size * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const DOT = inkColour(canvas);
    const cx0 = width / 2;
    const cy0 = size / 2;
    const writing = width * 0.47;
    // The scatter cloud fills the mark's own shape: a wide oval on a wide mark, never a ball.
    const cloudX = width * 0.46;
    const cloudY = size * 0.42;
    const dot = Math.max(0.55, width / 140);

    // The word is sampled once the page's font has loaded, so the letters are the brand's own.
    let word: Point2[] = [];
    // Which letter place each dot holds now; a shuffle hands every dot another's place.
    let slot: number[] = [];
    let next: number[] = [];
    let cloud: Point2[] = [];
    let seenCycle = -1;
    let seenEffect = '';

    let energy = stateRef.current === 'thinking' ? 1 : 0;
    let clock = 0;
    // Start halfway through the first scatter, so the word gathers out of a cloud on arrival.
    let wordClock = WORD_TIMELINE.hold + WORD_TIMELINE.change * 0.45;
    let last = performance.now();
    let frame = 0;
    let running = false;
    let cancelled = false;

    const enterCycle = (cycle: number, effect: string) => {
      if (seenEffect === 'shuffle') slot = next;
      seenCycle = cycle;
      seenEffect = effect;
      if (effect === 'shuffle') {
        const order = seededShuffle(word.length, cycle + 1);
        next = slot.map((_, index) => slot[order[index]!]!);
      }
      if (effect === 'scatter') cloud = seededCloud(word.length, cycle + 1);
    };

    const draw = (still = false) => {
      context.clearRect(0, 0, width, size);
      if (word.length === 0) return;
      const phase = still ? { cycle: 0, effect: 'scatter', progress: 0 } : wordPhase(wordClock);
      if (!still && phase.cycle !== seenCycle) enterCycle(phase.cycle, phase.effect);
      const fizz = still ? 0 : dot * (0.7 + energy * 1.3);
      // The glint's centre along the word (0 = left, 1 = right), passing every few seconds.
      const glint = ((clock * (0.32 + energy * 0.8)) % 1.6) - 0.3;

      for (let index = 0; index < word.length; index += 1) {
        const home = word[slot[index] ?? index]!;
        const hx = cx0 + home.x * writing;
        const hy = cy0 + home.y * writing;
        const place = (home.x + 1) / 2;
        const t = dotProgress(phase.progress, place);
        let x = hx;
        let y = hy;
        let flight = 0;

        if (t > 0) {
          if (phase.effect === 'scatter') {
            const far = cloud[index] ?? { x: 0, y: 0 };
            const cx = cx0 + far.x * cloudX;
            const cy = cy0 + far.y * cloudY;
            flight = outAndBack(t);
            const swirl = (index % 2 === 0 ? 1 : -1) * Math.sin(Math.PI * t) * 0.3;
            x = hx + (cx - hx) * flight - (cy - hy) * swirl;
            y = hy + (cy - hy) * flight + (cx - hx) * swirl;
          } else if (phase.effect === 'wave') {
            flight = Math.sin(Math.PI * t);
            y = hy - flight * size * 0.16;
            x = hx + flight * Math.sin(index) * width * 0.015;
          } else if (phase.effect === 'shuffle') {
            const target = word[next[index] ?? index]!;
            const tx = cx0 + target.x * writing;
            const ty = cy0 + target.y * writing;
            const travel = easeInOutCubic(t);
            flight = Math.sin(Math.PI * t);
            const swirl = (index % 2 === 0 ? 1 : -1) * flight * 0.25;
            x = hx + (tx - hx) * travel - (ty - hy) * swirl;
            y = hy + (ty - hy) * travel + (tx - hx) * swirl;
          } else {
            flight = outAndBack(t);
            const angle = flight * 2.6;
            const shrink = 1 - flight * 0.8;
            const ox = hx - cx0;
            const oy = hy - cy0;
            x = cx0 + (ox * Math.cos(angle) - oy * Math.sin(angle)) * shrink;
            y = cy0 + (ox * Math.sin(angle) + oy * Math.cos(angle)) * shrink;
          }
        }

        x += wobble(clock * 1.4, index * 0.37) * fizz;
        y += wobble(clock * 1.2 + 5, index * 0.61) * fizz;
        const shine = still ? 0 : Math.exp(-(((place - glint) / 0.09) ** 2));
        const twinkle = still ? 1 : 0.86 + 0.14 * Math.sin(clock * 3 + index * 1.7);
        context.fillStyle = rgba(DOT, twinkle - flight * 0.25 + shine * 0.2);
        context.beginPath();
        context.arc(x, y, dot * (1 + shine * 0.55 + flight * 0.35), 0, Math.PI * 2);
        context.fill();
      }
    };

    const tick = (now: number) => {
      const seconds = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = stateRef.current === 'thinking' ? 1 : 0;
      energy += (target - energy) * Math.min(1, seconds * 3);
      clock += seconds;
      // While MeroAI works, the changes come sooner: the hold runs faster, the changes themselves
      // keep their pace so they still read.
      const phase = wordPhase(wordClock);
      wordClock += seconds * (phase.progress > 0 ? 1 : 1 + energy * 1.5);
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

    void document.fonts.ready.then(() => {
      if (cancelled) return;
      word = wordPoints(width, getComputedStyle(canvas).fontFamily || 'sans-serif');
      slot = word.map((_, index) => index);
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
