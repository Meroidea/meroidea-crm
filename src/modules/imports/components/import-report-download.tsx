'use client';

import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { IMPORT_OUTCOME_LABELS, type ImportReportRow } from '@/modules/imports/schemas';
import { toCsv } from '@/lib/csv';

/** The upload report as CSV: row numbers, outcomes and reasons only — no personal details. */
export function ImportReportDownload({
  fileName,
  rows,
}: {
  fileName: string;
  rows: ImportReportRow[];
}) {
  const download = () => {
    const origin = window.location.origin;
    const csv = toCsv(
      rows.map((row) => ({
        Row: row.row,
        Outcome: IMPORT_OUTCOME_LABELS[row.outcome],
        Detail: row.reason ?? '',
        Record: row.contactId ? `${origin}/contacts/${row.contactId}` : '',
      })),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileName.replace(/\.[^.]+$/, '')}-report.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Button variant="outline" onClick={download} disabled={rows.length === 0}>
      <Download aria-hidden /> Download report
    </Button>
  );
}
