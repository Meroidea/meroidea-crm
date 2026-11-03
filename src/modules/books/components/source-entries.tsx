import { BookOpen } from 'lucide-react';
import Link from 'next/link';

import { formatCalendarDate } from '@/lib/format';
import { hasFeature, hasPermission, type TenantContext } from '@/server/context';

import { ENTRY_KIND_LABELS, formatAmount } from '../labels';
import { entriesForSource } from '../queries';

/**
 * "View entries" for a document: exactly what it posted to the books. Shown only to people who
 * can read the books, folded away so it stays out of the way for everyone else (ADR-060).
 */
export async function SourceEntries({
  ctx,
  sourceType,
  sourceId,
}: {
  ctx: TenantContext;
  sourceType: 'invoice' | 'payslip';
  sourceId: string;
}) {
  if (!hasFeature(ctx, 'books') || !hasPermission(ctx, 'books.view')) return null;
  const entries = await entriesForSource(ctx, sourceType, sourceId);
  return (
    <details className="no-print rounded-xl border bg-card px-4 py-3 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 font-medium">
        <BookOpen aria-hidden className="size-4" /> Ledger entries ({entries.length})
      </summary>
      {entries.length === 0 ? (
        <p className="mt-2 text-muted-foreground">
          Nothing in the books yet. Entries appear when this is sent, paid or released, once the
          books are set up.
        </p>
      ) : (
        <ul className="mt-2 divide-y">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Link
                href={`/books/entries/${entry.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 hover:bg-muted/50"
              >
                <span className="w-14 text-muted-foreground tabular-nums">#{entry.number}</span>
                <span className="w-28">{formatCalendarDate(entry.date)}</span>
                <span className="flex-1">{ENTRY_KIND_LABELS[entry.kind]}</span>
                <span className="tabular-nums">
                  {formatAmount(entry.total, ctx.tenant.currency)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
