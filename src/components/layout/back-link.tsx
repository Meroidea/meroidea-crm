'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';

import { cn } from '@/lib/utils';

/**
 * Goes back to the page the person came from when that page is on this site, and otherwise to
 * `fallback`: someone who arrived from an email link or a bookmark should not be sent off-site.
 * It is a real link to `fallback`, so it also works before the page's script has loaded.
 */
export function BackLink({
  fallback,
  label = 'Back',
  prefetch,
  className,
}: {
  fallback: string;
  label?: string;
  prefetch?: boolean;
  className?: string;
}) {
  const router = useRouter();

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    let sameSite = false;
    try {
      sameSite = new URL(document.referrer).origin === window.location.origin;
    } catch {
      sameSite = false;
    }
    if (sameSite && window.history.length > 1) {
      event.preventDefault();
      router.back();
    }
  }

  return (
    <Link
      href={fallback}
      prefetch={prefetch}
      onClick={onClick}
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        className,
      )}
    >
      <ArrowLeft
        aria-hidden
        className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5 motion-reduce:transition-none"
      />
      {label}
    </Link>
  );
}

/**
 * The workspace header's back control. Top-level pages (/contacts, /roster…) are reached from
 * the menu, so it shows only on pages inside them. The fallback is that top-level page, never a
 * guessed parent: /training/modules/<id> has no /training/modules page.
 */
export function HeaderBackLink() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  return <BackLink fallback={`/${segments[0]}`} prefetch={false} className="ml-1 px-1.5 py-1" />;
}
