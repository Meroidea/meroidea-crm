'use client';

import { X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { withParams } from '@/components/data/url';
import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Option = { value: string; label: string };

/**
 * Filters for the audit log, kept in the URL like every list (docs/architecture.md §4). Dates
 * and choices only; a free-text search would put names and addresses into the address bar.
 */
export function AuditFilters({
  filters,
  people,
  actions,
  types,
}: {
  filters: Record<string, string | undefined>;
  people: Option[];
  actions: Option[];
  types: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const apply = (changes: Record<string, string | undefined>) =>
    startTransition(() =>
      router.replace(withParams(pathname, filters, changes), { scroll: false }),
    );

  const selects = [
    { name: 'person', label: 'Person', allLabel: 'Everyone', options: people },
    { name: 'action', label: 'Action', allLabel: 'All actions', options: actions },
    { name: 'type', label: 'Record type', allLabel: 'All records', options: types },
  ];
  const hasFilters = Object.entries(filters).some(([key, value]) => key !== 'cursor' && value);

  return (
    <div
      role="search"
      aria-label="Filter the audit log"
      className={cn('flex flex-wrap items-end gap-2', isPending && 'opacity-80')}
    >
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground sm:flex-none">
        From
        <Input
          type="date"
          value={filters.from ?? ''}
          max={filters.to}
          onChange={(event) => apply({ from: event.target.value || undefined })}
          className="w-full sm:w-auto"
        />
      </label>
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground sm:flex-none">
        To
        <Input
          type="date"
          value={filters.to ?? ''}
          min={filters.from}
          onChange={(event) => apply({ to: event.target.value || undefined })}
          className="w-full sm:w-auto"
        />
      </label>
      {selects.map((select) => (
        <NativeSelect
          key={select.name}
          aria-label={select.label}
          value={filters[select.name] ?? ''}
          onChange={(event) => apply({ [select.name]: event.target.value || undefined })}
          className="w-full sm:w-auto sm:min-w-36"
        >
          <option value="">{select.allLabel}</option>
          {select.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      ))}
      {hasFilters && (
        <Button
          variant="ghost"
          onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}
        >
          <X aria-hidden /> Clear
        </Button>
      )}
    </div>
  );
}
