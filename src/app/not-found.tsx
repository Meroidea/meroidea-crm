import type { Metadata } from 'next';
import Link from 'next/link';

import { DotBackground } from '@/components/layout/dot-background';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Page not found' };

/**
 * Every 404: an address that matches no page, a record that no longer exists, or an area the
 * person may not see (the platform console answers "not found" to non-owners on purpose).
 * Same dotted background as the rest of the site, and it never says which of those it was.
 */
export default function NotFound() {
  return (
    <div className="relative isolate flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-12">
      <DotBackground />
      <Link href="/" className="flex items-center gap-2 font-semibold">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">
          M
        </span>
        Meroidea
      </Link>
      <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-1 text-xl font-semibold">This page could not be found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The address may be mistyped, or what it pointed to has moved or been removed.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href="/dashboard">Go to your workspace</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Home page</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
