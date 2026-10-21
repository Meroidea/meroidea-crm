import Link from 'next/link';

import { BackLink } from '@/components/layout/back-link';
import { DotBackground } from '@/components/layout/dot-background';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-12">
      <DotBackground />
      {/* Back to the page the person came from, or to the home page from an email link. */}
      <BackLink fallback="/" className="absolute top-4 left-4 sm:top-6 sm:left-6" />
      <Link href="/" className="flex items-center gap-2 font-semibold">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">
          M
        </span>
        Meroidea
      </Link>
      {children}
    </div>
  );
}
