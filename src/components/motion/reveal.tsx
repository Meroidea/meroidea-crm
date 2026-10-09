'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Stagger, in milliseconds, applied after the element scrolls into view. */
  delay?: number;
  /** Resting tilt the card straightens out of, echoing a fanned deck. */
  tilt?: number;
  style?: CSSProperties;
};

/**
 * Plays a fade-and-rise entrance once, the first time the element is scrolled into view.
 * The animation itself lives in globals.css so it can be disabled for prefers-reduced-motion
 * and for readers without scripting.
 */
export function Reveal({ children, className, delay = 0, tilt = 0, style }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || visible) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '-80px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div
      ref={ref}
      data-visible={visible}
      className={cn('reveal', className)}
      style={
        { '--reveal-delay': `${delay}ms`, '--reveal-tilt': `${tilt}deg`, ...style } as CSSProperties
      }
    >
      {children}
    </div>
  );
}
