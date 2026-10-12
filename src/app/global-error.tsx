'use client';

import { DotBackground } from '@/components/layout/dot-background';

import './globals.css';

/**
 * Last-resort screen when the root layout itself fails. It replaces the whole document, so it
 * brings its own <html>, <body> and styles (Next.js file conventions). Error details are never
 * shown: in production they are withheld from the browser anyway.
 */
export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <title>Something went wrong · Meroidea</title>
        <div className="relative isolate flex min-h-svh items-center justify-center px-4 py-12">
          <DotBackground />
          <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center">
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Meroidea could not load this page. Your records are safe. Try again in a moment.
            </p>
            <button
              type="button"
              onClick={retry}
              className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
