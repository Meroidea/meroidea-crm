import { ChevronRight, ChevronsLeft } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

import { withParams } from './url';

export function ListPagination({
  pathname,
  filters,
  nextCursor,
  shown,
}: {
  pathname: string;
  filters: Record<string, string | undefined>;
  nextCursor: string | null;
  shown: number;
}) {
  const onLaterPage = Boolean(filters.cursor);
  if (!nextCursor && !onLaterPage) return null;

  return (
    <div className="flex items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
      <span>Showing {shown}</span>
      <div className="flex gap-2">
        {onLaterPage && (
          <Button asChild variant="outline" size="sm">
            <Link href={withParams(pathname, filters, {})}>
              <ChevronsLeft aria-hidden /> First page
            </Link>
          </Button>
        )}
        {nextCursor && (
          <Button asChild variant="outline" size="sm">
            <Link href={withParams(pathname, filters, { cursor: nextCursor })}>
              Next <ChevronRight aria-hidden />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
