'use client';

import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

import {
  fibonacciSphere,
  mix,
  parseRgb,
  particleCount,
  rgba,
  rotate,
  wobble,
  type Rgb,
} from './mero-orb-math';

export type MeroOrbState = 'idle' | 'thinking';

/** A theme token (or any CSS colour) as numbers, read the way the browser resolves it. */
function resolveRgb(token: string, fallback: Rgb): Rgb {
  const raw = token.startsWith('--')
    ? getComputedStyle(document.documentElement).getPropertyValue(token).trim()
    : token;
  if (!raw) return fallback;
  // A canvas normalises any CSS colour it accepts to #rrggbb or rgba(): let it do the parsing.
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) return fallback;
  probe.fillStyle = '#000';
  probe.fillStyle = raw;
  return parseRgb(String(probe.fillStyle)) ?? fallback;
}

type Particle = {
  base: { x: number; y: number; z: number };
  /** Ribbon particles flow and glow; the rest make the shell. */
  ribbon: number | null;
  color: Rgb;
  phase: number;
};

/**
 * The MeroAI orb (ADR-078): a sphere of glowing particles on a deep core, coloured from the
 * theme (the business's primary and the brand chart palette), with ribbons that flow around it.
 * At rest it turns slowly and breathes; while MeroAI works it spins faster and the ribbons
 * surge. Decorative: the words around it carry the meaning.
 *
 * Drawn on a plain canvas, no library. It pauses when off screen or in a background tab, and
 * draws one still frame for people who ask for reduced motion.
 */
export function MeroOrb({
  size = 32,
  state = 'idle',
  className,
}: {
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
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const primary = resolveRgb('--primary', { r: 75, g: 73, b: 172 });
    const sky = resolveRgb('--chart-2', { r: 152, g: 189, b: 255 });
    const blue = resolveRgb('--chart-3', { r: 125, g: 160, b: 250 });
    const violet = resolveRgb('--chart-4', { r: 121, g: 120, b: 233 });
    const coral = resolveRgb('--chart-5', { r: 243, g: 121, b: 126 });
    const night = { r: 6, g: 6, b: 28 };
    const core = mix(primary, night, 0.72);
    const white = { r: 255, g: 255, b: 255 };

    // Three tilted great circles: particles near one become part of a flowing ribbon.
    const ribbons = [
      { x: 0.2, y: 0.95, z: 0.25 },
      { x: 0.85, y: 0.3, z: -0.4 },
      { x: -0.5, y: 0.45, z: 0.75 },
    ].map((n) => {
      const length = Math.hypot(n.x, n.y, n.z);
      return { x: n.x / length, y: n.y / length, z: n.z / length };
    });
    const particles: Particle[] = fibonacciSphere(particleCount(size)).map((base, index) => {
      const near = ribbons.findIndex(
        (n) => Math.abs(base.x * n.x + base.y * n.y + base.z * n.z) < 0.16,
      );
      const ribbon = near >= 0 && index % 3 !== 0 ? near : null;
      const shade = (index * 0.618) % 1;
      return {
        base,
        ribbon,
        color:
          ribbon === null
            ? mix(sky, blue, shade)
            : mix(violet, coral, ribbon === 1 ? 0.75 : shade * 0.6),
        phase: shade * Math.PI * 2,
      };
    });

    const center = size / 2;
    const radius = size * 0.34;
    const dot = Math.max(0.55, size / 110);
    let yaw = 0;
    let energy = stateRef.current === 'thinking' ? 1 : 0;
    let clock = 0;
    let last = performance.now();
    let frame = 0;
    let running = false;

    const draw = () => {
      context.clearRect(0, 0, size, size);
      const surge = 0.05 + energy * 0.12;
      const breathe = 1 + Math.sin(clock * 1.6) * (0.012 + energy * 0.02);
      const r = radius * breathe;

      // The deep core, then the halo that makes it read on a light page.
      const halo = context.createRadialGradient(center, center, r * 0.4, center, center, size / 2);
      halo.addColorStop(0, rgba(primary, 0.55 + energy * 0.25));
      halo.addColorStop(0.62, rgba(violet, 0.18 + energy * 0.12));
      halo.addColorStop(1, rgba(primary, 0));
      context.fillStyle = halo;
      context.fillRect(0, 0, size, size);
      const body = context.createRadialGradient(
        center - r * 0.3,
        center - r * 0.35,
        r * 0.1,
        center,
        center,
        r * 1.05,
      );
      body.addColorStop(0, rgba(mix(core, primary, 0.45), 1));
      body.addColorStop(1, rgba(core, 1));
      context.fillStyle = body;
      context.beginPath();
      context.arc(center, center, r * 1.02, 0, Math.PI * 2);
      context.fill();

      context.globalCompositeOperation = 'lighter';
      const tilt = 0.38 + Math.sin(clock * 0.35) * 0.12;
      for (const particle of particles) {
        let lift = 1 + wobble(particle.phase, clock * 0.6) * 0.012;
        if (particle.ribbon !== null) {
          lift =
            1 +
            Math.max(0, wobble(particle.phase * 2 + particle.ribbon, clock * (0.9 + energy))) *
              surge;
        }
        const p = rotate(
          { x: particle.base.x * lift, y: particle.base.y * lift, z: particle.base.z * lift },
          yaw + (particle.ribbon ?? 0) * 0.15 * Math.sin(clock * 0.5),
          tilt,
        );
        const depth = (p.z + 1.2) / 2.4;
        const perspective = 1 / (1.6 - p.z * 0.35);
        const x = center + p.x * r * perspective * 1.6;
        const y = center + p.y * r * perspective * 1.6;
        const near = Math.pow(Math.min(1, Math.max(0, depth)), 1.6);
        if (particle.ribbon !== null) {
          context.fillStyle = rgba(particle.color, (0.12 + near * 0.3) * (0.7 + energy * 0.5));
          context.beginPath();
          context.arc(x, y, dot * (2.2 + near * 1.6), 0, Math.PI * 2);
          context.fill();
        }
        context.fillStyle = rgba(
          particle.ribbon === null ? particle.color : mix(particle.color, white, 0.25),
          0.12 + near * 0.85,
        );
        context.beginPath();
        context.arc(x, y, dot * (0.55 + near * 0.9), 0, Math.PI * 2);
        context.fill();
      }

      // A thin rim of light, like the edge of the sphere catching it.
      const rim = context.createRadialGradient(center, center, r * 0.92, center, center, r * 1.12);
      rim.addColorStop(0, rgba(sky, 0));
      rim.addColorStop(0.55, rgba(sky, 0.28 + energy * 0.2));
      rim.addColorStop(1, rgba(sky, 0));
      context.fillStyle = rim;
      context.beginPath();
      context.arc(center, center, r * 1.12, 0, Math.PI * 2);
      context.fill();
      context.globalCompositeOperation = 'source-over';
    };

    const tick = (now: number) => {
      const seconds = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = stateRef.current === 'thinking' ? 1 : 0;
      energy += (target - energy) * Math.min(1, seconds * 3);
      clock += seconds;
      yaw += seconds * (0.28 + energy * 1.1);
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
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn('shrink-0 rounded-full', className)}
      style={{ width: size, height: size }}
    />
  );
}
