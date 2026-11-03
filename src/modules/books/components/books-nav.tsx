import Link from 'next/link';

import { cn } from '@/lib/utils';

const TABS = [
  { href: '/books', label: 'Overview' },
  { href: '/books/entries', label: 'Transactions' },
  { href: '/books/accounts', label: 'Chart of accounts' },
  { href: '/books/reports', label: 'Reports' },
  { href: '/books/settings', label: 'Settings' },
] as const;

/** The books' own sections; the current one is marked for screen readers too. */
export function BooksNav({ current }: { current: (typeof TABS)[number]['href'] }) {
  return (
    <nav aria-label="Books" className="no-print -mx-1 flex gap-1 overflow-x-auto pb-1">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={current === tab.href ? 'page' : undefined}
          className={cn(
            'shrink-0 rounded-full border px-3 py-1 text-sm text-muted-foreground hover:text-foreground',
            current === tab.href && 'border-primary bg-primary/5 font-medium text-foreground',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
