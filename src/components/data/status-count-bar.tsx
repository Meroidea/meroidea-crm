import Link from 'next/link';

import { cn } from '@/lib/utils';

export type CountTone = 'primary' | 'info' | 'muted' | 'destructive' | 'chart-2' | 'chart-3';

export type CountItem = {
  key: string;
  label: string;
  count: number;
  href: string;
  active: boolean;
  tone?: CountTone;
};

const TONE_BAR: Record<CountTone, string> = {
  primary: 'bg-primary',
  info: 'bg-info',
  muted: 'bg-muted-foreground/40',
  destructive: 'bg-destructive',
  'chart-2': 'bg-chart-2',
  'chart-3': 'bg-chart-3',
};

/**
 * The shape of the population before anyone searches (docs/research/selma-analysis.md §4):
 * one chip per status with its count; clicking filters the list through the URL. Colour is a
 * side bar only — the label and number always carry the meaning.
 */
export function StatusCountBar({ items, label }: { items: CountItem[]; label: string }) {
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex w-max gap-2 md:w-auto md:flex-wrap">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              scroll={false}
              aria-current={item.active ? 'true' : undefined}
              className={cn(
                'relative flex min-w-28 flex-col gap-0.5 overflow-hidden rounded-lg border bg-card py-2 pr-4 pl-4 text-left transition-colors hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                item.active && 'border-primary bg-accent',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'absolute inset-y-0 left-0 w-[3px]',
                  TONE_BAR[item.tone ?? 'primary'],
                )}
              />
              <span className="text-xs text-muted-foreground">{item.label}</span>
              <span
                className={cn(
                  'text-lg leading-tight font-semibold tabular-nums',
                  item.active && 'text-primary',
                )}
              >
                {item.count.toLocaleString('en-AU')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
