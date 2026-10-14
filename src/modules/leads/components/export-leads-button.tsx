'use client';

import { Download } from 'lucide-react';
import { useState, useTransition } from 'react';

import { saveCsv } from '@/components/data/csv-download';
import { Button } from '@/components/ui/button';
import { exportLeadsAction } from '@/modules/leads/actions';
import type { LeadQueueFilters } from '@/modules/leads/schemas';

/** Downloads the leads in the current view and filters as CSV. */
export function ExportLeadsButton({ filters }: { filters: LeadQueueFilters }) {
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <Button
        variant="outline"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setNote(null);
            const result = await exportLeadsAction({ ...filters, cursor: undefined });
            if (!result.ok) return setNote(result.error.message);
            saveCsv(`leads-${new Date().toISOString().slice(0, 10)}.csv`, result.data.csv);
            if (result.data.truncated) {
              setNote(
                `First ${result.data.rows.toLocaleString('en-AU')} leads exported; filter to narrow it down.`,
              );
            }
          })
        }
      >
        <Download aria-hidden /> {isPending ? 'Exporting…' : 'Export'}
      </Button>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </span>
  );
}
