'use client';

import {
  ArrowRight,
  ChevronRight,
  LayoutDashboard,
  Menu,
  Sparkles,
  Tag,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { Dialog } from 'radix-ui';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

type MenuLink = { href: string; label: string; hint: string; icon: LucideIcon; tint: string };

const MENU_LINKS: MenuLink[] = [
  {
    href: '#product',
    label: 'Product',
    hint: 'See the workspace in action',
    icon: LayoutDashboard,
    tint: 'var(--chart-1)',
  },
  {
    href: '#features',
    label: 'Features',
    hint: 'What every plan includes',
    icon: Sparkles,
    tint: 'var(--chart-4)',
  },
  {
    href: '#about',
    label: 'About',
    hint: 'Why we built it',
    icon: Users,
    tint: 'var(--chart-3)',
  },
  {
    href: '#pricing',
    label: 'Pricing',
    hint: 'One price per person',
    icon: Tag,
    tint: 'var(--chart-5)',
  },
];

/** Each row arrives a beat after the one above it, once the panel itself has landed. */
const stagger = (index: number) => ({ animationDelay: `${120 + index * 55}ms` });

const ENTER =
  'animate-in fill-mode-both fade-in-0 slide-in-from-right-6 duration-500 ease-out motion-reduce:animate-none';

/**
 * The phone navigation: a floating glass panel that swings in from the right while the page
 * behind it blurs and dims. Built on the dialog primitive, so focus is trapped, Escape closes it
 * and the page underneath cannot scroll while it is open.
 */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon-lg" className="-mr-2 sm:hidden" aria-label="Open menu">
          <Menu className="size-5" />
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/25 backdrop-blur-md duration-300 sm:hidden data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />

        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-3 right-3 z-50 flex w-[min(21rem,calc(100vw-1.5rem))] origin-top-right flex-col overflow-hidden rounded-3xl border border-white/70 bg-background/85 shadow-2xl shadow-primary/25 backdrop-blur-2xl duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] outline-none motion-reduce:animate-none sm:hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-90 data-open:slide-in-from-right-16 data-closed:animate-out data-closed:duration-200 data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:slide-out-to-right-16"
        >
          {/* Soft brand glow behind the header; decorative only. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-[radial-gradient(closest-side,var(--chart-2),transparent)] opacity-60"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-28 -left-20 size-64 rounded-full bg-[radial-gradient(closest-side,var(--chart-4),transparent)] opacity-25"
          />

          <div className="relative flex items-center justify-between px-5 pt-5">
            <Dialog.Title asChild>
              <Link
                href="/"
                onClick={close}
                className="flex items-center gap-2.5 text-lg font-semibold tracking-tight"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-lg text-primary-foreground">
                  M
                </span>
                Meroidea
              </Link>
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button
                variant="outline"
                size="icon-lg"
                className="rounded-full bg-card/70"
                aria-label="Close menu"
              >
                <X className="size-4" />
              </Button>
            </Dialog.Close>
          </div>

          <p
            className={`relative mt-7 px-5 text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase ${ENTER}`}
            style={stagger(0)}
          >
            Explore
          </p>

          <nav aria-label="Main" className="relative mt-3 flex flex-col gap-1.5 px-3">
            {MENU_LINKS.map(({ href, label, hint, icon: Icon, tint }, index) => (
              <Link
                key={href}
                href={href}
                onClick={close}
                style={stagger(index + 1)}
                className={`group flex items-center gap-3.5 rounded-2xl border border-transparent px-2.5 py-2.5 transition-colors hover:border-border hover:bg-card/80 active:bg-card ${ENTER}`}
              >
                <span
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
                  style={{ background: tint }}
                >
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold tracking-tight">{label}</span>
                  <span className="block truncate text-sm text-muted-foreground">{hint}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </nav>

          <div
            className={`relative mt-auto px-4 pt-6 pb-5 ${ENTER}`}
            style={stagger(MENU_LINKS.length + 1)}
          >
            <div className="rounded-2xl border bg-card/80 p-4 shadow-sm">
              <p className="text-sm font-semibold">Start with a 14-day trial</p>
              <p className="mt-0.5 text-sm text-muted-foreground">No card needed to begin.</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button asChild size="lg" variant="outline">
                  <Link href="/login" onClick={close}>
                    Sign in
                  </Link>
                </Button>
                <Button asChild size="lg">
                  <Link href="/signup" onClick={close}>
                    Start free
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
