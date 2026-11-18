'use client';

import { Download } from 'lucide-react';
import { useState, useTransition } from 'react';

import { saveCsv } from '@/components/data/csv-download';
import { Button } from '@/components/ui/button';
import { exportAuditLogAction } from '@/modules/audit/actions';
import type { AuditFilters } from '@/modules/audit/schemas';

/** Downloads the entries under the current filters as CSV; the export is itself audited. */
export function ExportAuditButton({ filters }: { filters: AuditFilters }) {
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
      <Button
        variant="outline"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setNote(null);
            const result = await exportAuditLogAction({ ...filters, cursor: undefined });
            if (!result.ok) return setNote(result.error.message);
            saveCsv(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, result.data.csv);
            if (result.data.truncated) {
              setNote(
                `Newest ${result.data.rows.toLocaleString('en-AU')} entries exported; narrow the dates for the rest.`,
              );
            }
          })
        }
      >
        <Download aria-hidden /> {isPending ? 'Exporting…' : 'Export'}
      </Button>
    </span>
  );
}
