'use client';

import Link from 'next/link';

import { MobileMenu } from '@/components/marketing/mobile-menu';

import { useScrolled } from '@/components/motion/use-scrolled';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { href: '#product', label: 'Product' },
  { href: '#features', label: 'Features' },
  { href: '#about', label: 'About' },
  { href: '#pricing', label: 'Pricing' },
];

export function SiteHeader() {
  const scrolled = useScrolled();

  return (
    <header
      className={cn(
        'sticky top-0 z-30 border-b transition-[background-color,border-color] duration-500 ease-out',
        scrolled
          ? 'border-border bg-background/80 backdrop-blur-xl'
          : 'border-transparent bg-transparent',
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 text-xl font-semibold tracking-tight"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-lg text-primary-foreground">
            M
          </span>
          Meroidea
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1">
          {/* Handed over from the hero: the calls to action fly up here once the reader scrolls. */}
          <div
            inert={!scrolled}
            aria-hidden={!scrolled}
            className={cn(
              'flex items-center gap-1 transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none',
              scrolled
                ? 'translate-y-0 scale-100 opacity-100'
                : 'pointer-events-none -translate-y-3 scale-95 opacity-0',
            )}
          >
            <Button asChild variant="ghost" size="lg" className="hidden sm:inline-flex">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="lg">
              <Link href="/signup">Start free</Link>
            </Button>
          </div>

          {/* Phones have no room for the nav row, so the same links live in a slide-in panel. */}
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}
