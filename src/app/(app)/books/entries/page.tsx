import { BookOpen } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { withParams } from '@/components/data/url';
import { NativeSelect } from '@/components/forms/native-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatCalendarDate } from '@/lib/format';
import { BooksNav } from '@/modules/books/components/books-nav';
import { ENTRY_KIND_LABELS, formatAmount } from '@/modules/books/labels';
import { getBooksSettings, listEntries } from '@/modules/books/queries';
import { ENTRY_KINDS, entryParamsSchema } from '@/modules/books/schemas';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Transactions' };

export default async function EntriesPage({ searchParams }: PageProps<'/books/entries'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'books.view');
  if (!(await getBooksSettings(ctx))) redirect('/books');
  const params = entryParamsSchema.parse(await searchParams);
  const { items, nextCursor } = await listEntries(ctx, params);
  const filters = { kind: params.kind, q: params.q, from: params.from, to: params.to };

  return (
    <div className="flex w-full max-w-5xl flex-col gap-5">
      <PageHeader title="Transactions" description="Every entry in the books, newest first." />
      <BooksNav current="/books/entries" />
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <label className="flex flex-col gap-1 text-sm">
          Search
          <Input
            name="q"
            defaultValue={params.q}
            placeholder="Payee, description, reference"
            className="w-56"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Kind
          <NativeSelect name="kind" defaultValue={params.kind ?? ''} className="w-auto">
            <option value="">All</option>
            {ENTRY_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {ENTRY_KIND_LABELS[kind]}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          From
          <Input type="date" name="from" defaultValue={params.from} className="w-auto" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To
          <Input type="date" name="to" defaultValue={params.to} className="w-auto" />
        </label>
        <Button type="submit" size="sm">
          Filter
        </Button>
      </form>
      <Card>
        <CardContent>
          {items.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="No transactions"
              description="Nothing matches these filters."
            />
          ) : (
            <ul className="divide-y">
              {items.map((entry) => (
                <li key={entry.id}>
                  <Link
                    href={`/books/entries/${entry.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 hover:bg-muted/50"
                  >
                    <span className="w-12 text-sm text-muted-foreground tabular-nums">
                      #{entry.number}
                    </span>
                    <span className="w-24 text-sm">{formatCalendarDate(entry.date)}</span>
                    <span className="min-w-0 flex-1 basis-48">
                      <span className="block truncate">{entry.description}</span>
                      {entry.contactName && (
                        <span className="block truncate text-sm text-muted-foreground">
                          {entry.contactName}
                        </span>
                      )}
                    </span>
                    <Badge variant="outline">{ENTRY_KIND_LABELS[entry.kind]}</Badge>
                    {entry.isAdjustment && <Badge variant="outline">Adjustment</Badge>}
                    {entry.reversed && <Badge variant="destructive">Voided</Badge>}
                    <span className="w-28 text-right tabular-nums">
                      {formatAmount(entry.total, ctx.tenant.currency)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {nextCursor && (
            <div className="pt-3">
              <Button asChild variant="outline" size="sm">
                <Link href={withParams('/books/entries', filters, { cursor: nextCursor })}>
                  Older
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
