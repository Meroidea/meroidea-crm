'use client';

import { CheckCircle2, FileUp, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import Papa from 'papaparse';
import { useState } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { importContactsChunkAction } from '@/modules/imports/actions';
import {
  IMPORT_CHUNK_SIZE,
  IMPORT_FIELDS,
  type ImportChunkResult,
  type ImportFieldKey,
} from '@/modules/imports/schemas';

const MAX_ROWS = 10_000;

function suggest(header: string): ImportFieldKey | '' {
  const clean = header.trim().toLowerCase().replace(/[_-]+/g, ' ');
  return (
    IMPORT_FIELDS.find((field) => (field.hints as readonly string[]).includes(clean))?.key ?? ''
  );
}

type Parsed = { fileName: string; headers: string[]; rows: Record<string, string>[] };

/**
 * CSV import (docs/architecture.md §8): parse in the browser, map columns, then send rows to the
 * server in chunks; each chunk is validated and written in one transaction.
 */
export function ImportWizard({
  sources,
  contactLabel,
}: {
  sources: { value: string; label: string }[];
  contactLabel: string;
}) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Record<string, ImportFieldKey | ''>>({});
  const [sourceId, setSourceId] = useState('');
  const [duplicates, setDuplicates] = useState<'skip' | 'create'>('skip');
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<ImportChunkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = (file: File) => {
    setError(null);
    setResult(null);
    if (file.size > 10 * 1024 * 1024) {
      setError('That file is over 10 MB. Split it into smaller files.');
      return;
    }
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (output) => {
        const headers = (output.meta.fields ?? []).filter(Boolean);
        if (headers.length === 0 || output.data.length === 0) {
          setError('No rows found. The first line should be column names.');
          return;
        }
        if (output.data.length > MAX_ROWS) {
          setError(`That file has ${output.data.length} rows; import up to ${MAX_ROWS} at a time.`);
          return;
        }
        setParsed({ fileName: file.name, headers, rows: output.data });
        setMapping(Object.fromEntries(headers.map((header) => [header, suggest(header)])));
      },
      error: () => setError('Could not read that file. Save it as CSV (UTF-8) and try again.'),
    });
  };

  const mapped = Object.values(mapping).filter(Boolean);
  const hasName = mapped.includes('firstName') || mapped.includes('fullName');

  const run = async () => {
    if (!parsed) return;
    setError(null);
    const total: ImportChunkResult = { created: 0, skippedDuplicates: 0, invalid: [] };
    const rows = parsed.rows.map((raw) => {
      const row: Record<string, string> = {};
      for (const [header, key] of Object.entries(mapping)) {
        if (key && raw[header] !== undefined) row[key] = String(raw[header]).slice(0, 500);
      }
      return row;
    });
    setProgress(0);
    for (let start = 0; start < rows.length; start += IMPORT_CHUNK_SIZE) {
      const response = await importContactsChunkAction({
        rows: rows.slice(start, start + IMPORT_CHUNK_SIZE),
        firstRowNumber: start + 2,
        sourceId,
        duplicates,
      });
      if (!response.ok) {
        setError(`Stopped at row ${start + 2}: ${response.error.message}`);
        break;
      }
      total.created += response.data.created;
      total.skippedDuplicates += response.data.skippedDuplicates;
      total.invalid.push(...response.data.invalid);
      setProgress(Math.min(rows.length, start + IMPORT_CHUNK_SIZE) / rows.length);
    }
    setResult(total);
    setProgress(null);
  };

  if (result) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-xl border bg-accent/60 p-4">
          <CheckCircle2 aria-hidden className="mt-0.5 size-5 text-primary" />
          <div>
            <p className="font-medium">Import finished</p>
            <p className="text-sm text-muted-foreground">
              {result.created} {contactLabel.toLowerCase()} records created ·{' '}
              {result.skippedDuplicates} duplicates skipped · {result.invalid.length} rows with
              problems
            </p>
          </div>
        </div>
        {result.invalid.length > 0 && (
          <div className="rounded-xl border">
            <p className="flex items-center gap-2 border-b px-4 py-2 text-sm font-medium">
              <TriangleAlert aria-hidden className="size-4 text-warning-text" /> Rows that were not
              imported
            </p>
            <ul className="max-h-60 overflow-y-auto px-4 py-2 text-sm">
              {result.invalid.slice(0, 200).map((item) => (
                <li key={item.row} className="py-1">
                  Row {item.row}: <span className="text-muted-foreground">{item.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/contacts">View {contactLabel.toLowerCase()} list</Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setParsed(null);
              setResult(null);
            }}
          >
            Import another file
          </Button>
        </div>
      </div>
    );
  }

  if (!parsed) {
    return (
      <div className="flex flex-col gap-3">
        <label className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed bg-card px-6 py-12 text-center transition-colors hover:border-primary/50 hover:bg-accent/40">
          <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <FileUp aria-hidden className="size-6" />
          </span>
          <span className="font-medium">Choose a CSV file</span>
          <span className="max-w-sm text-sm text-muted-foreground">
            First row = column names. Up to {MAX_ROWS.toLocaleString('en-AU')} rows. Exported from
            Excel or Google Sheets as CSV works.
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
            }}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive-text">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="font-medium">
          {parsed.fileName} · {parsed.rows.length.toLocaleString('en-AU')} rows
        </p>
        <p className="text-sm text-muted-foreground">
          Match each column to a field. We guessed where we could.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Column in file</TableHead>
              <TableHead>Example</TableHead>
              <TableHead className="pr-4">Import as</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parsed.headers.map((header) => (
              <TableRow key={header}>
                <TableCell className="pl-4 font-medium">{header}</TableCell>
                <TableCell className="max-w-48 truncate text-muted-foreground">
                  {parsed.rows[0]?.[header] ?? ''}
                </TableCell>
                <TableCell className="pr-4">
                  <NativeSelect
                    aria-label={`Import ${header} as`}
                    value={mapping[header] ?? ''}
                    onChange={(event) =>
                      setMapping({
                        ...mapping,
                        [header]: event.target.value as ImportFieldKey | '',
                      })
                    }
                    className="h-8 min-w-44"
                  >
                    <option value="">Don’t import</option>
                    {IMPORT_FIELDS.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                  </NativeSelect>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="import-source">Source for every row</Label>
          <NativeSelect
            id="import-source"
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
          >
            <option value="">Not recorded</option>
            {sources.map((source) => (
              <option key={source.value} value={source.value}>
                {source.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="import-duplicates">If the email or phone already exists</Label>
          <NativeSelect
            id="import-duplicates"
            value={duplicates}
            onChange={(event) => setDuplicates(event.target.value as 'skip' | 'create')}
          >
            <option value="skip">Skip that row</option>
            <option value="create">Create it anyway</option>
          </NativeSelect>
        </div>
      </div>

      {progress !== null && (
        <div>
          <div className="mb-1 flex justify-between text-sm">
            <span>Importing…</span>
            <span className="tabular-nums">{Math.round(progress * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={run} disabled={!hasName || progress !== null}>
          Import {parsed.rows.length.toLocaleString('en-AU')} rows
        </Button>
        <Button variant="ghost" onClick={() => setParsed(null)} disabled={progress !== null}>
          Choose another file
        </Button>
        {!hasName && (
          <p className="text-sm text-muted-foreground">
            Map a first-name or full-name column to continue.
          </p>
        )}
      </div>
    </div>
  );
}
