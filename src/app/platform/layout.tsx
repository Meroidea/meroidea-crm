import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { requirePlatformAdmin } from '@/server/platform';

export const metadata: Metadata = {
  title: { default: 'Platform', template: '%s · Meroidea platform' },
};

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const admin = await requirePlatformAdmin();
  return (
    <div className="min-h-svh">
      <header className="flex h-14 items-center gap-4 border-b bg-card px-4 sm:px-8">
        <Link href="/platform" className="flex items-center gap-2 font-semibold">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">
            M
          </span>
          Meroidea platform
        </Link>
        <span className="ml-auto hidden text-sm text-muted-foreground sm:inline">
          {admin.email}
        </span>
        <Link href="/dashboard" className="text-sm text-primary underline-offset-4 hover:underline">
          My workspace
        </Link>
      </header>
      <main className="mx-auto w-full max-w-5xl p-4 sm:p-8">{children}</main>
    </div>
  );
}
