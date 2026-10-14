'use client';

import { CsvDownload } from '@/components/data/csv-download';
import { recordReportExportAction } from '@/modules/reports/actions';

/** Download one report table as CSV; the export is recorded first. */
export function ReportCsv({
  report,
  fileName,
  rows,
}: {
  report: string;
  fileName: string;
  rows: Record<string, string | number | null>[];
}) {
  return (
    <CsvDownload
      fileName={fileName}
      rows={rows}
      record={() => recordReportExportAction({ report, rows: rows.length })}
    />
  );
}
