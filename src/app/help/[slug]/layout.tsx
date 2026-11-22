import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { getPublicPortal } from '@/modules/kb/public';

/** A business's public help portal (ADR-071): its own header, then the page. */
export default async function PortalLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const portal = await getPublicPortal((await params).slug);
  if (!portal) notFound();
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-4">
          <Link href={`/help/${portal.slug}`} className="min-w-0">
            <p className="truncate text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              {portal.businessName}
            </p>
            <p className="truncate text-lg font-semibold">{portal.title}</p>
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t py-4 text-center text-xs text-muted-foreground">
        Help centre of {portal.businessName}
      </footer>
    </div>
  );
}
