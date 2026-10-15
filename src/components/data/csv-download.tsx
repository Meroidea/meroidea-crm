'use client';

import { Download } from 'lucide-react';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/errors';
import { toCsv } from '@/lib/csv';

/** Saves text as a file in the browser. */
export function saveCsv(fileName: string, csv: string) {
  // A byte-order mark so Excel reads accented names correctly.
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * A CSV of rows already on the page. `record` is called first, so the export is audited before
 * the file is made; if it fails, nothing is downloaded.
 */
export function CsvDownload({
  fileName,
  rows,
  record,
  label = 'CSV',
}: {
  fileName: string;
  rows: Record<string, string | number | null>[];
  record: () => Promise<ActionResult<unknown>>;
  label?: string;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={isPending || rows.length === 0}
      onClick={() =>
        startTransition(async () => {
          const result = await record();
          if (result.ok) saveCsv(fileName, toCsv(rows));
        })
      }
    >
      <Download aria-hidden /> {label}
    </Button>
  );
}
