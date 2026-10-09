import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { NAVIGATION, navItemTitle } from '@/components/layout/navigation';
import type { Labels } from '@/lib/tenant/labels';

/**
 * The home screen for a business without the sales features: a way into each area it does have.
 * Built from the same navigation list as the sidebar, so it always matches what the person can
 * actually open.
 */
export function WorkspaceHome({
  greeting,
  businessName,
  labels,
  permissions,
  features,
}: {
  greeting: string;
  businessName: string;
  labels: Labels;
  permissions: string[];
  features: string[];
}) {
  const granted = new Set(permissions);
  const areas = NAVIGATION.flatMap((group) =>
    group.items
      .filter(
        (item) =>
          item.available &&
          item.href !== '/dashboard' &&
          (!item.permission || granted.has(item.permission)) &&
          (!item.feature || features.includes(item.feature)),
      )
      .map((item) => ({ item, group: group.title })),
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{greeting}</h1>
        <p className="text-sm text-muted-foreground">
          Everything {businessName} runs here, in one place.
        </p>
      </header>
      {areas.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          Nothing has been switched on for you yet. Ask your workspace admin for access.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map(({ item, group }) => {
            const { href, icon: Icon } = item;
            return (
              <li key={href}>
                <Link
                  href={href}
                  className="group flex h-full items-center gap-3 rounded-xl border bg-card p-4 transition-shadow hover:shadow-md"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                    <Icon aria-hidden className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{navItemTitle(item, labels)}</span>
                    <span className="block text-xs text-muted-foreground">{group}</span>
                  </span>
                  <ArrowRight
                    aria-hidden
                    className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
