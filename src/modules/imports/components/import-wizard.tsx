'use client';

import { CheckCircle2, FileUp, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { readSpreadsheet } from '@/lib/spreadsheet';
import type { SourceOption } from '@/modules/contacts/components/contact-form';
import { LEAD_TYPE_LABELS, type LeadType } from '@/modules/contacts/schemas';
import {
  finishImportAction,
  importContactsChunkAction,
  startImportAction,
} from '@/modules/imports/actions';
import {
  IMPORT_CHUNK_SIZE,
  IMPORT_FIELDS,
  IMPORT_MAX_ROWS,
  type ImportChunkResult,
  type ImportDuplicateStrategy,
  type ImportTarget,
} from '@/modules/imports/schemas';

type Target = { key: ImportTarget; label: string; hints: readonly string[] };

const normalizeHeader = (header: string) => header.trim().toLowerCase().replace(/[_-]+/g, ' ');

function suggest(header: string, targets: Target[], taken: Set<string>): ImportTarget | '' {
  const clean = normalizeHeader(header);
  const match = targets.find((target) => !taken.has(target.key) && target.hints.includes(clean));
  return match?.key ?? '';
}

type Parsed = { fileName: string; headers: string[]; rows: Record<string, string>[] };

/** First row = column names; blank or repeated names get a column number so none is lost. */
function toRecords(fileName: string, table: string[][]): Parsed {
  const [head = [], ...body] = table;
  const seen = new Map<string, number>();
  const headers = head.map((cell, index) => {
    const name = cell.trim() || `Column ${index + 1}`;
    const times = seen.get(name) ?? 0;
    seen.set(name, times + 1);
    return times === 0 ? name : `${name} (${times + 1})`;
  });
  const rows = body.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])),
  );
  return { fileName, headers, rows };
}

/**
 * Spreadsheet upload (docs/leads.md §3.1, docs/architecture.md §8): read in the browser (CSV or
 * Excel), map columns, choose what every row shares, then send rows to the server in chunks.
 * The server keeps the batch, checks every row like the form does, and writes a report.
 */
export function ImportWizard({
  sources,
  leadTypes,
  customFields,
  contactLabel,
  canMerge,
  canQueue,
}: {
  sources: SourceOption[];
  leadTypes: LeadType[];
  customFields: { key: string; label: string }[];
  contactLabel: string;
  canMerge: boolean;
  canQueue: boolean;
}) {
  const targets: Target[] = [
    ...IMPORT_FIELDS.map((field) => ({ key: field.key, label: field.label, hints: field.hints })),
    ...customFields.map((field) => ({
      key: `custom.${field.key}` as const,
      label: field.label,
      hints: [normalizeHeader(field.label), normalizeHeader(field.key)],
    })),
  ];

  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Record<string, ImportTarget | ''>>({});
  const [asLeads, setAsLeads] = useState(sources.length > 0);
  const [leadType, setLeadType] = useState<LeadType | ''>(
    leadTypes.length === 1 ? (leadTypes[0] ?? '') : '',
  );
  const [sourceId, setSourceId] = useState('');
  const [subSourceId, setSubSourceId] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [duplicates, setDuplicates] = useState<ImportDuplicateStrategy>('skip');
  const [assignment, setAssignment] = useState<'me' | 'auto' | 'queue'>('me');
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<(ImportChunkResult & { batchId: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const source = sources.find((candidate) => candidate.id === sourceId);

  const onFile = async (file: File) => {
    setError(null);
    setResult(null);
    if (file.size > 10 * 1024 * 1024) {
      setError('That file is over 10 MB. Split it into smaller files.');
      return;
    }
    let table: string[][];
    try {
      table = await readSpreadsheet(file);
    } catch {
      setError('Could not read that file. Use an .xlsx workbook or a CSV (UTF-8) file.');
      return;
    }
    const records = toRecords(file.name, table);
    if (records.headers.length === 0 || records.rows.length === 0) {
      setError('No rows found. The first line should be column names.');
      return;
    }
    if (records.rows.length > IMPORT_MAX_ROWS) {
      setError(
        `That file has ${records.rows.length} rows; import up to ${IMPORT_MAX_ROWS.toLocaleString('en-AU')} at a time.`,
      );
      return;
    }
    const taken = new Set<string>();
    const guesses: Record<string, ImportTarget | ''> = {};
    for (const header of records.headers) {
      const guess = suggest(header, targets, taken);
      if (guess) taken.add(guess);
      guesses[header] = guess;
    }
    setParsed(records);
    setMapping(guesses);
  };

  const mapped = Object.values(mapping).filter(Boolean);
  const hasName = mapped.includes('firstName') || mapped.includes('fullName');
  const doubled = mapped.find((key, index) => mapped.indexOf(key) !== index);
  const needsSub = asLeads && Boolean(source && source.subSources.length > 0);
  const leadReady =
    !asLeads || (Boolean(sourceId) && (!needsSub || Boolean(subSourceId)) && Boolean(leadType));
  const ready = hasName && !doubled && leadReady;

  const run = async () => {
    if (!parsed) return;
    setError(null);
    const started = await startImportAction({
      fileName: parsed.fileName.slice(0, 200),
      rowCount: parsed.rows.length,
      asLeads,
      leadType: asLeads ? leadType : '',
      sourceId,
      subSourceId,
      campaignName,
      duplicates,
      assignment: asLeads ? assignment : 'me',
    });
    if (!started.ok) {
      setError(started.error.message);
      return;
    }
    const batchId = started.data.id;
    const total: ImportChunkResult = {
      created: 0,
      merged: 0,
      skippedDuplicates: 0,
      duplicatesCreated: 0,
      invalid: [],
    };
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
        batchId,
      });
      if (!response.ok) {
        setError(`Stopped at row ${start + 2}: ${response.error.message}`);
        break;
      }
      total.created += response.data.created;
      total.merged += response.data.merged;
      total.skippedDuplicates += response.data.skippedDuplicates;
      total.duplicatesCreated += response.data.duplicatesCreated;
      total.invalid.push(...response.data.invalid);
      setProgress(Math.min(rows.length, start + IMPORT_CHUNK_SIZE) / rows.length);
    }
    await finishImportAction({ batchId });
    setResult({ ...total, batchId });
    setProgress(null);
  };

  if (result) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-xl border bg-accent/60 p-4">
          <CheckCircle2 aria-hidden className="mt-0.5 size-5 text-primary" />
          <div>
            <p className="font-medium">Upload finished</p>
            <p className="text-sm text-muted-foreground">
              {result.created + result.duplicatesCreated} created
              {result.duplicatesCreated > 0 &&
                ` (${result.duplicatesCreated} despite a duplicate)`}{' '}
              · {result.merged} merged · {result.skippedDuplicates} duplicates skipped ·{' '}
              {result.invalid.length} rows with problems
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
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={`/imports/${result.batchId}`}>Open the full report</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={asLeads ? '/leads' : '/contacts'}>
              {asLeads ? 'Go to leads' : `View ${contactLabel.toLowerCase()} list`}
            </Link>
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setParsed(null);
              setResult(null);
            }}
          >
            Upload another file
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
          <span className="font-medium">Choose an Excel or CSV file</span>
          <span className="max-w-sm text-sm text-muted-foreground">
            First row = column names. Up to {IMPORT_MAX_ROWS.toLocaleString('en-AU')} rows. The
            first sheet of an .xlsx workbook is read.
          </span>
          <input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFile(file);
              event.target.value = '';
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
                        [header]: event.target.value as ImportTarget | '',
                      })
                    }
                    className="h-8 min-w-44"
                  >
                    <option value="">Don’t import</option>
                    {targets.map((target) => (
                      <option key={target.key} value={target.key}>
                        {target.label}
                      </option>
                    ))}
                  </NativeSelect>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <fieldset className="flex flex-col gap-4 rounded-xl border p-4">
        <legend className="px-1 text-sm font-medium">What every row shares</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={asLeads}
            onChange={(event) => setAsLeads(event.target.checked)}
          />
          <span>
            <span className="font-medium">Import as leads</span>
            <span className="block text-muted-foreground">
              They start as New in the lead queue, with the source below. Untick to add plain{' '}
              {contactLabel.toLowerCase()} records.
            </span>
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          {asLeads && leadTypes.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-lead-type">Lead type</Label>
              <NativeSelect
                id="import-lead-type"
                value={leadType}
                onChange={(event) => setLeadType(event.target.value as LeadType | '')}
              >
                <option value="">Choose…</option>
                {leadTypes.map((type) => (
                  <option key={type} value={type}>
                    {LEAD_TYPE_LABELS[type]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-source">
              Source{asLeads && <span className="text-destructive-text"> *</span>}
            </Label>
            <NativeSelect
              id="import-source"
              value={sourceId}
              onChange={(event) => {
                setSourceId(event.target.value);
                setSubSourceId('');
              }}
            >
              <option value="">{asLeads ? 'Choose…' : 'Not recorded'}</option>
              {sources.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          {source && source.subSources.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-sub-source">
                Sub-source{asLeads && <span className="text-destructive-text"> *</span>}
              </Label>
              <NativeSelect
                id="import-sub-source"
                value={subSourceId}
                onChange={(event) => setSubSourceId(event.target.value)}
              >
                <option value="">{asLeads ? 'Choose…' : 'Not recorded'}</option>
                {source.subSources.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-campaign">Campaign or event name</Label>
            <Input
              id="import-campaign"
              maxLength={120}
              value={campaignName}
              onChange={(event) => setCampaignName(event.target.value)}
              placeholder="e.g. Expo Sydney 2026"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-duplicates">If the person already exists</Label>
            <NativeSelect
              id="import-duplicates"
              value={duplicates}
              onChange={(event) => setDuplicates(event.target.value as ImportDuplicateStrategy)}
            >
              <option value="skip">Skip that row</option>
              {canMerge && (
                <option value="merge">Merge: fill the gaps in the existing record</option>
              )}
              <option value="create">Create it anyway</option>
            </NativeSelect>
          </div>
          {asLeads && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-assignment">Assign to</Label>
              <NativeSelect
                id="import-assignment"
                value={assignment}
                onChange={(event) => setAssignment(event.target.value as typeof assignment)}
              >
                <option value="me">Me</option>
                <option value="auto">Routing rules (falls back to me)</option>
                {canQueue && <option value="queue">The unassigned queue</option>}
              </NativeSelect>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Duplicates are matched on email, phone, or the same name at the same company — against
          your workspace and earlier rows of this file.
        </p>
      </fieldset>

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
        <Button onClick={run} disabled={!ready || progress !== null}>
          Import {parsed.rows.length.toLocaleString('en-AU')} rows
        </Button>
        <Button variant="ghost" onClick={() => setParsed(null)} disabled={progress !== null}>
          Choose another file
        </Button>
        {!hasName ? (
          <p className="text-sm text-muted-foreground">
            Map a first-name or full-name column to continue.
          </p>
        ) : doubled ? (
          <p className="text-sm text-muted-foreground">Two columns are mapped to the same field.</p>
        ) : !leadReady ? (
          <p className="text-sm text-muted-foreground">
            Choose the lead type, source{needsSub ? ' and sub-source' : ''} to continue.
          </p>
        ) : null}
      </div>
    </div>
  );
}
