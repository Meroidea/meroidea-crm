import { ArrowRight, History, KeyRound, MapPin, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

/*
 * Only links to pages and sections that exist today. Add Privacy, Terms and Contact here when
 * those pages ship — never as placeholders that go nowhere.
 */
const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { href: '/#product', label: 'Overview' },
      { href: '/#features', label: 'Features' },
      { href: '/#pricing', label: 'Pricing' },
    ],
  },
  {
    title: 'Company',
    links: [{ href: '/#about', label: 'About us' }],
  },
  {
    title: 'Get started',
    links: [
      { href: '/signup', label: 'Start free trial' },
      { href: '/login', label: 'Sign in to your workspace' },
    ],
  },
];

const TRUST = [
  { icon: MapPin, label: 'Data stored in Australia' },
  { icon: KeyRound, label: 'Role-based access' },
  { icon: History, label: 'Every change audited' },
  { icon: ShieldCheck, label: 'Isolated per workspace' },
];

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative mt-8 overflow-hidden rounded-t-[2rem] border-t border-foreground/10 bg-[color-mix(in_srgb,var(--foreground)_9%,var(--background))] sm:rounded-t-[3rem]">
      {/* A blueprint grid that fades out towards the bottom, a brand glow and a hairline along
          the top edge. All decorative. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,color-mix(in_srgb,var(--foreground)_6%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_srgb,var(--foreground)_6%,transparent)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_80%_70%_at_50%_0%,black,transparent)] [background-size:44px_44px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-[8%] top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-44 left-1/2 h-80 w-[46rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
      />

      <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-8">
        {/* Call to action */}
        <div className="relative mt-10 flex flex-col items-start justify-between gap-6 overflow-hidden rounded-2xl border border-white/80 bg-card/90 p-6 shadow-xl shadow-foreground/5 sm:mt-14 sm:p-10 md:flex-row md:items-center">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-[radial-gradient(closest-side,var(--chart-2),transparent)] opacity-40"
          />
          <div className="relative max-w-xl">
            <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              Bring your whole business into one workspace
            </h2>
            <p className="mt-3 text-muted-foreground">
              Set up in minutes, shaped around how your team already works. 14-day trial, no card
              needed.
            </p>
          </div>
          <div className="relative flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Button asChild size="lg" className="group">
              <Link href="/signup">
                Start free
                <ArrowRight
                  aria-hidden
                  className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="bg-card">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </div>

        {/* Brand + links */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 py-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="col-span-2 max-w-sm lg:col-span-1 lg:max-w-xs">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm text-primary-foreground shadow-sm">
                M
              </span>
              Meroidea
            </Link>
            <p className="mt-4 text-sm text-muted-foreground">
              People, sales, work, documents and the numbers behind them — one platform, one login.
            </p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {TRUST.map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="flex items-center gap-1.5 rounded-full border border-foreground/10 bg-card/70 px-2.5 py-1 text-xs text-foreground/75"
                >
                  <Icon aria-hidden className="size-3.5 shrink-0 text-primary" />
                  {label}
                </li>
              ))}
            </ul>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h3 className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                {column.title}
              </h3>
              <ul className="mt-4 flex flex-col gap-3">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-foreground/80 underline-offset-4 transition-colors hover:text-primary hover:underline"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="flex flex-col gap-2 border-t border-foreground/10 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} Meroidea. All rights reserved.</p>
          <p className="flex items-center gap-1.5">
            <MapPin aria-hidden className="size-3.5" /> Built and hosted in Sydney, Australia
          </p>
        </div>
      </div>

      {/* Oversized wordmark, cropped by the bottom edge. Decorative. */}
      <p
        aria-hidden
        className="pointer-events-none -mb-[0.28em] bg-gradient-to-b from-foreground/15 to-transparent bg-clip-text text-center text-[22vw] leading-none font-semibold tracking-tighter text-transparent select-none lg:text-[16rem]"
      >
        Meroidea
      </p>
    </footer>
  );
}
