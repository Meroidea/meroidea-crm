'use client';

import Link from 'next/link';

import { useScrolled } from '@/components/motion/use-scrolled';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The centred calls to action, which hand themselves over to the header on first scroll.
 * They fade and lift away without giving up their space: collapsing the row would re-lay-out the
 * whole page for half a second, right as the tablet below starts to move.
 */
export function HeroCta() {
  const scrolled = useScrolled();

  return (
    <div
      inert={scrolled}
      aria-hidden={scrolled}
      className={cn(
        'transition-[opacity,transform] duration-500 ease-out will-change-[opacity,transform] motion-reduce:transition-none',
        scrolled
          ? 'pointer-events-none -translate-y-4 scale-95 opacity-0'
          : 'translate-y-0 scale-100 opacity-100',
      )}
    >
      <div>
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="w-32 sm:w-auto">
            <Link href="/signup">Start free</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="w-32 sm:w-auto">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">14-day trial. No card needed to start.</p>
      </div>
    </div>
  );
}
