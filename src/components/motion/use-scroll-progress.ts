'use client';

import { useEffect, useRef } from 'react';

type TiltOptions = {
  /** Share of the element (from its top edge) that should be visible at rest, 0–1. */
  visibleShare: number;
  /** Scale of the element at rest. */
  restScale: number;
  /** CSS perspective of the stage, px. The vanishing point sits on the element's top edge. */
  perspective: number;
  /** Tilt limits, degrees. */
  minAngle: number;
  maxAngle: number;
  /** Height of whatever is pinned to the top of the screen (the sticky header), px. */
  topInset: number;
};

export type TiltFrame = {
  /** 0 at rest, 1 once the element is flat and fully on screen. */
  progress: number;
  /** Tilt to start from, degrees. */
  restAngle: number;
  /** How far the stage is lowered at rest, px. */
  restShift: number;
};

/** Projected distance below the hinge of a point `y` px down an element tilted back by `angle`. */
function projectedDrop(y: number, angle: number, perspective: number): number {
  const radians = (angle * Math.PI) / 180;
  return (y * Math.cos(radians) * perspective) / (perspective - y * Math.sin(radians));
}

/**
 * Scroll-linked progress for a tilted stage, plus the tilt to start from.
 *
 * `progress` is 0 at the top of the page whenever the stage starts on screen, and reaches 1 at the
 * exact scroll position where the whole element sits on screen, centred in the space under the
 * pinned header — so it is never straightened while partly scrolled away. `restAngle` is solved
 * per screen so that exactly the top `visibleShare` of the element is visible between the stage's
 * top and the bottom edge of the screen: the screen edge clips it, and no empty band is left
 * underneath. A fixed angle can't do that — near 90° the element is edge-on and only a sliver
 * would show. When even `minAngle` falls short of the edge, `restShift` lowers the stage the
 * remaining distance.
 *
 * Built to stay smooth: the page is measured only when its layout changes, never while scrolling,
 * and each frame is handed to `apply` to write straight to the elements. Nothing here causes a
 * React render, so a heavy subtree inside the stage is not re-rendered sixty times a second.
 *
 * Readers who ask for reduced motion get the settled state.
 */
export function useScrollProgress<Stage extends HTMLElement, Drawn extends HTMLElement>(
  options: TiltOptions,
  apply: (frame: TiltFrame) => void,
) {
  const ref = useRef<Stage>(null);
  const drawnRef = useRef<Drawn>(null);
  const { visibleShare, restScale, perspective, minAngle, maxAngle, topInset } = options;

  useEffect(() => {
    const stage = ref.current;
    const drawn = drawnRef.current;
    if (!stage || !drawn) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      apply({ progress: 1, restAngle: 0, restShift: 0 });
      return;
    }

    const solveAngle = (available: number, height: number) => {
      const y = height * restScale * visibleShare;
      // Less tilt shows more; find the tilt whose visible part ends exactly at `available`.
      let low = minAngle;
      let high = maxAngle;
      if (projectedDrop(y, low, perspective) <= available) return low;
      if (projectedDrop(y, high, perspective) >= available) return high;
      for (let step = 0; step < 24; step += 1) {
        const mid = (low + high) / 2;
        if (projectedDrop(y, mid, perspective) > available) low = mid;
        else high = mid;
      }
      return (low + high) / 2;
    };

    // Layout facts, refreshed by measure(); the scroll path only reads them.
    let start = 0;
    let end = 1;
    let restAngle = maxAngle;
    let restShift = 0;
    // The shift currently written to the stage; its measured position includes it.
    let applied = 0;
    let viewport = window.innerHeight;
    let viewportWidth = window.innerWidth;
    let last = -1;
    let frame = 0;

    const paint = () => {
      const progress = Math.min(1, Math.max(0, (window.scrollY - start) / (end - start)));
      // Rounded so sub-pixel scroll noise doesn't cause needless style writes.
      const key = Math.round(progress * 2000) + restAngle * 1e4 + restShift * 1e7;
      if (key === last) return;
      last = key;
      applied = restShift * (1 - progress);
      apply({ progress, restAngle, restShift });
    };

    const measure = () => {
      // Phone browsers resize the window as the address bar slides away mid-scroll. Following
      // that would re-solve the tilt under the reader's thumb, so the height is only re-read
      // when the width changes too (rotation, a real resize) or the jump is clearly not a bar.
      if (window.innerWidth !== viewportWidth || Math.abs(window.innerHeight - viewport) > 160) {
        viewport = window.innerHeight;
        viewportWidth = window.innerWidth;
      }

      const stageTop = stage.getBoundingClientRect().top + window.scrollY - applied;
      // offsetHeight is the untransformed layout height, unaffected by the tilt itself.
      const height = drawn.offsetHeight;
      // Where the element's top edge should be once flat: centred below the header, or just
      // under it when the element is nearly as tall as the space.
      const settledTop = topInset + Math.max(16, (viewport - topInset - height) / 2);
      start = Math.max(0, stageTop - viewport * 0.8);
      end = Math.max(start + 1, stageTop - settledTop);

      const available = viewport - stageTop + 1;
      restAngle = solveAngle(available, height);
      // On tall screens even the least allowed tilt can't reach the bottom edge: lower the stage
      // the rest of the way so no empty band is left underneath.
      const drop = projectedDrop(height * restScale * visibleShare, restAngle, perspective);
      restShift = stageTop < viewport ? Math.max(0, Math.round(available - drop)) : 0;
      paint();
    };

    // One write per frame at most; scroll fires far more often than the screen repaints.
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        paint();
      });
    };

    let measureFrame = 0;
    const onLayout = () => {
      if (measureFrame) return;
      measureFrame = requestAnimationFrame(() => {
        measureFrame = 0;
        measure();
      });
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onLayout, { passive: true });
    // Fonts loading or content above changing height moves the stage without any scroll.
    const layout = new ResizeObserver(onLayout);
    layout.observe(document.body);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onLayout);
      layout.disconnect();
      if (frame) cancelAnimationFrame(frame);
      if (measureFrame) cancelAnimationFrame(measureFrame);
    };
  }, [visibleShare, restScale, perspective, minAngle, maxAngle, topInset, apply]);

  return { ref, drawnRef };
}
