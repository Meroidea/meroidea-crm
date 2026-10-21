'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

type Phase = 'idle' | 'loading' | 'done';

/**
 * A thin bar along the top of the window from the moment a link is followed until the next page
 * is on screen, so every click answers at once even on a slow connection. It starts on clicks of
 * same-site links (not new tabs, downloads or links to the page already open) and on Back and
 * Forward. It is finished once the address differs from the one it started on, or after ten
 * seconds at most.
 */
function ProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const here = `${pathname}?${searchParams.toString()}`;
  const hereRef = useRef(here);
  const [run, setRun] = useState<{ phase: Phase; from: string }>({ phase: 'idle', from: '' });
  const phase: Phase = run.phase === 'loading' && run.from !== here ? 'done' : run.phase;

  useEffect(() => {
    hereRef.current = here;
  }, [here]);

  useEffect(() => {
    let safety: number | undefined;
    // Started from the page being left; on Back and Forward the address has not changed yet.
    const start = () => {
      setRun({ phase: 'loading', from: hereRef.current });
      window.clearTimeout(safety);
      safety = window.setTimeout(
        () => setRun((current) => ({ ...current, phase: 'done' })),
        10_000,
      );
    };
    const onClick = (event: MouseEvent) => {
      // Not event.defaultPrevented: Next.js links prevent the default to navigate themselves.
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a');
      if (!anchor?.href || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return;
      }
      start();
    };
    document.addEventListener('click', onClick);
    window.addEventListener('popstate', start);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('popstate', start);
      window.clearTimeout(safety);
    };
  }, []);

  // Once complete, let the bar fade out, then rest.
  useEffect(() => {
    if (phase !== 'done') return;
    const rest = window.setTimeout(() => setRun({ phase: 'idle', from: '' }), 450);
    return () => window.clearTimeout(rest);
  }, [phase]);

  return (
    <div
      aria-hidden
      data-phase={phase}
      className="nav-progress pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px] print:hidden"
    />
  );
}

export function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <ProgressBar />
    </Suspense>
  );
}
