import Link from 'next/link';

import { DotBackground } from '@/components/layout/dot-background';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-12">
      <DotBackground />
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
