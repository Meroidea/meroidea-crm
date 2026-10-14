'use client';

import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { stageColorVar } from '@/lib/stage-color';
import { assignLeadsAction } from '@/modules/leads/actions';

export type LeadTableRow = {
  id: string;
  fullName: string;
  companyName: string | null;
  leadType: 'b2b' | 'b2c' | null;
  statusName: string;
  statusColor: string | null;
  source: string | null;
  ownerName: string | null;
  handoverToName: string | null;
  created: string;
  completeness: number;
  overdue: 'first_contact' | 'acceptance' | null;
};

export function LeadsTable({
  rows,
  owners,
  canAssign,
}: {
  rows: LeadTableRow[];
  owners: { value: string; label: string }[];
  canAssign: boolean;
}) {
  const { run, error, isPending } = useActionRunner();
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState('auto');
  const [message, setMessage] = useState<string | null>(null);
  const allSelected = rows.length > 0 && selected.length === rows.length;
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );

  return (
    <div className="flex flex-col">
      {canAssign && selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-3 text-sm">
          <span className="font-medium">{selected.length} selected</span>
          <NativeSelect
            aria-label="Assign to"
            className="w-auto"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="auto">Assign by routing rules</option>
            <option value="queue">Return to the unassigned queue</option>
            {owners.map((owner) => (
              <option key={owner.value} value={owner.value}>
                Assign to {owner.label}
              </option>
            ))}
          </NativeSelect>
          <Button
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(
                () =>
                  target === 'auto'
                    ? assignLeadsAction({ mode: 'auto', contactIds: selected })
                    : assignLeadsAction({
                        mode: 'person',
                        contactIds: selected,
                        ownerUserId: target === 'queue' ? null : target,
                      }),
                (data) => {
                  setSelected([]);
                  setMessage(
                    data.skipped > 0
                      ? `${data.assigned} assigned; ${data.skipped} unchanged (no rule matched or already theirs).`
                      : `${data.assigned} assigned.`,
                  );
                },
              )
            }
          >
            {isPending ? 'Assigning…' : 'Apply'}
          </Button>
          <ErrorNote error={error} />
        </div>
      )}
      {message && (
        <p role="status" className="border-b px-4 py-2 text-sm text-muted-foreground">
          {message}
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {canAssign && (
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  className="size-4 accent-primary"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? [] : rows.map((row) => row.id))}
                />
              </TableHead>
            )}
            <TableHead>Lead</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Source</TableHead>
            <TableHead className="hidden lg:table-cell">Owner</TableHead>
            <TableHead className="hidden lg:table-cell">Complete</TableHead>
            <TableHead className="hidden sm:table-cell">Added</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} data-state={selected.includes(row.id) ? 'selected' : undefined}>
              {canAssign && (
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.fullName}`}
                    className="size-4 accent-primary"
                    checked={selected.includes(row.id)}
                    onChange={() => toggle(row.id)}
                  />
                </TableCell>
              )}
              <TableCell className="max-w-64">
                <Link href={`/contacts/${row.id}`} className="block hover:text-primary">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{row.fullName}</span>
                    {row.leadType && (
                      <Badge variant="outline" className="shrink-0">
                        {row.leadType === 'b2b' ? 'B2B' : 'B2C'}
                      </Badge>
                    )}
                  </span>
                  {row.companyName && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.companyName}
                    </span>
                  )}
                </Link>
              </TableCell>
              <TableCell>
                <span className="flex flex-col gap-1">
                  <span className="inline-flex items-center gap-1.5 text-sm">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: stageColorVar(row.statusColor) }}
                    />
                    {row.statusName}
                  </span>
                  {row.overdue && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive-text">
                      <AlertTriangle aria-hidden className="size-3" />
                      {row.overdue === 'acceptance'
                        ? 'Acceptance overdue'
                        : 'First contact overdue'}
                    </span>
                  )}
                  {row.handoverToName && !row.overdue && (
                    <span className="text-xs text-muted-foreground">With {row.handoverToName}</span>
                  )}
                </span>
              </TableCell>
              <TableCell className="hidden text-sm md:table-cell">{row.source ?? '—'}</TableCell>
              <TableCell className="hidden text-sm lg:table-cell">
                {row.ownerName ?? <span className="text-muted-foreground">Unassigned</span>}
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${row.completeness}%` }}
                    />
                  </span>
                  <span className="text-xs tabular-nums">{row.completeness}%</span>
                </span>
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                {row.created}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
