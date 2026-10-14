import Link from 'next/link';

import { cn } from '@/lib/utils';
import type { ReportRange } from '@/modules/reports/queries';

const RANGES: ReportRange[] = [30, 90, 365];

function Segmented({
  label,
  items,
}: {
  label: string;
  items: { href: string; text: string; active: boolean }[];
}) {
  return (
    <nav aria-label={label} className="flex rounded-lg border bg-card p-0.5">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm',
            item.active
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {item.text}
        </Link>
      ))}
    </nav>
  );
}

/** Which report (sales or leads) and over what period; both keep the other's choice. */
export function ReportNav({
  page,
  range,
}: {
  page: '/reports' | '/reports/leads';
  range: ReportRange;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Segmented
        label="Report"
        items={[
          { href: `/reports?range=${range}`, text: 'Sales', active: page === '/reports' },
          {
            href: `/reports/leads?range=${range}`,
            text: 'Leads',
            active: page === '/reports/leads',
          },
        ]}
      />
      <Segmented
        label="Date range"
        items={RANGES.map((value) => ({
          href: `${page}?range=${value}`,
          text: value === 365 ? '12 months' : `${value} days`,
          active: value === range,
        }))}
      />
    </div>
  );
}

export function parseRange(value: string | string[] | undefined): ReportRange {
  return RANGES.find((option) => String(option) === value) ?? 90;
}
