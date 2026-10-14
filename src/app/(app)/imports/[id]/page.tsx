import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/data/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { LEAD_TYPE_LABELS } from '@/modules/contacts/schemas';
import { ImportReportDownload } from '@/modules/imports/components/import-report-download';
import { getImportBatch } from '@/modules/imports/queries';
import { IMPORT_OUTCOME_LABELS } from '@/modules/imports/schemas';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Upload report' };

const STRATEGY: Record<string, string> = {
  skip: 'Duplicates skipped',
  merge: 'Duplicates merged into the existing record',
  create: 'Duplicates created anyway',
};

const SHOWN_ROWS = 1000;

export default async function ImportReportPage({ params }: PageProps<'/imports/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'contacts.import');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const batch = await getImportBatch(ctx, id);
  if (!batch) notFound();

  // Rows created cleanly are the bulk of a good upload; the report leads with what needs a look.
  const order = { error: 0, skipped: 1, duplicate_created: 2, merged: 3, created: 4 } as const;
  const rows = [...batch.rows].sort((a, b) => order[a.outcome] - order[b.outcome] || a.row - b.row);
  const stats = [
    ['Rows in file', batch.rowCount],
    ['Created', batch.createdCount],
    ['Created despite a duplicate', batch.duplicateCreatedCount],
    ['Merged', batch.mergedCount],
    ['Skipped', batch.skippedCount],
    ['Problems', batch.errorCount],
  ] as const;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link href="/imports">
          <ArrowLeft aria-hidden /> Imports
        </Link>
      </Button>
      <PageHeader
        title={batch.fileName}
        description={[
          `Uploaded ${formatDateTime(ctx, batch.createdAt)}`,
          batch.createdByName ? `by ${batch.createdByName}` : null,
          batch.asLeads
            ? `as leads${batch.leadType ? ` (${LEAD_TYPE_LABELS[batch.leadType]})` : ''}`
            : null,
          batch.sourceName
            ? `from ${batch.sourceName}${batch.subSourceName ? ` – ${batch.subSourceName}` : ''}`
            : null,
          batch.campaignName,
          STRATEGY[batch.duplicateStrategy],
          batch.completedAt ? null : 'not finished',
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={<ImportReportDownload fileName={batch.fileName} rows={rows} />}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([title, value]) => (
          <div key={title} className="rounded-xl border bg-card p-3">
            <p className="text-xs text-muted-foreground">{title}</p>
            <p className="text-xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <Card>
        <CardContent className="px-0">
          {rows.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground">No rows were processed.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Row</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead className="pr-6">Record</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, SHOWN_ROWS).map((row) => (
                    <TableRow key={`${row.row}-${row.outcome}`}>
                      <TableCell className="pl-6 tabular-nums">{row.row}</TableCell>
                      <TableCell>{IMPORT_OUTCOME_LABELS[row.outcome]}</TableCell>
                      <TableCell className="text-muted-foreground">{row.reason ?? ''}</TableCell>
                      <TableCell className="pr-6">
                        {row.contactId && (
                          <Link
                            href={`/contacts/${row.contactId}`}
                            className="text-primary hover:underline"
                          >
                            Open
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rows.length > SHOWN_ROWS && (
                <p className="px-6 pt-3 text-sm text-muted-foreground">
                  Showing the first {SHOWN_ROWS.toLocaleString('en-AU')} rows; download the report
                  for all {rows.length.toLocaleString('en-AU')}.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
