'use client';

import { Search, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { NativeSelect } from '../forms/native-select';
import { withParams } from './url';

export type FilterSelect = {
  name: string;
  label: string;
  allLabel: string;
  options: { value: string; label: string }[];
};

/**
 * Search and filters live in the URL (docs/architecture.md §4), so a view can be bookmarked,
 * shared with a colleague and survives the back button.
 */
export function FilterBar({
  filters,
  selects,
  searchLabel,
}: {
  filters: Record<string, string | undefined>;
  selects: FilterSelect[];
  searchLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q ?? '');
  const latest = useRef(filters);
  useEffect(() => {
    latest.current = filters;
  }, [filters]);

  const apply = (changes: Record<string, string | undefined>) =>
    startTransition(() =>
      router.replace(withParams(pathname, latest.current, changes), { scroll: false }),
    );

  useEffect(() => {
    if (query === (latest.current.q ?? '')) return;
    const timer = setTimeout(() => apply({ q: query.trim() || undefined }), 300);
    return () => clearTimeout(timer);
    // apply only reads refs and stable router functions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const hasFilters = Boolean(filters.q) || selects.some((select) => filters[select.name]);

  return (
    <div
      role="search"
      className={cn('flex flex-col gap-2 sm:flex-row sm:items-center', isPending && 'opacity-80')}
    >
      <div className="relative flex-1">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchLabel}
          aria-label={searchLabel}
          className="pl-9"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {selects.map((select) => (
          <NativeSelect
            key={select.name}
            aria-label={select.label}
            value={filters[select.name] ?? ''}
            onChange={(event) => apply({ [select.name]: event.target.value || undefined })}
            className="w-auto min-w-36"
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
            onClick={() => {
              setQuery('');
              startTransition(() => router.replace(pathname, { scroll: false }));
            }}
          >
            <X aria-hidden /> Clear
          </Button>
        )}
      </div>
    </div>
  );
}
