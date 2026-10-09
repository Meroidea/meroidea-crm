import Link from 'next/link';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { initials } from '@/lib/format';
import type { ContactListRow } from '@/modules/contacts/types';

import { ContactStatusBadge } from './contact-status-badge';

type Row = ContactListRow & { createdLabel: string; isMine: boolean };

export function ContactsTable({ rows }: { rows: Row[] }) {
  return (
    <>
      {/* Phones get a stacked list; the table needs room for its columns. */}
      <ul className="divide-y md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/contacts/${row.id}`}
              className="flex items-center gap-3 px-4 py-3 active:bg-accent"
            >
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
              >
                {initials(row.fullName)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{row.fullName}</span>
                <span data-sensitive className="block truncate text-xs text-muted-foreground">
                  {row.email ?? row.phone ?? 'No contact details'}
                </span>
              </span>
              <ContactStatusBadge status={row.status} />
            </Link>
          </li>
        ))}
      </ul>

      <Table className="hidden md:table">
        <TableHeader className="sticky top-0 bg-card">
          <TableRow>
            <TableHead className="pl-4">Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Source</TableHead>
            <TableHead className="pr-4 text-right">Added</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} className="group relative">
              <TableCell className="pl-4">
                <Link
                  href={`/contacts/${row.id}`}
                  className="flex items-center gap-3 font-medium group-hover:text-primary after:absolute after:inset-0"
                >
                  <span
                    aria-hidden
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
                  >
                    {initials(row.fullName)}
                  </span>
                  <span className="max-w-56 truncate">{row.fullName}</span>
                </Link>
              </TableCell>
              <TableCell data-sensitive className="max-w-56 truncate text-muted-foreground">
                {row.email ?? '—'}
              </TableCell>
              <TableCell data-sensitive className="text-muted-foreground tabular-nums">
                {row.phone ?? '—'}
              </TableCell>
              <TableCell>
                <ContactStatusBadge status={row.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {row.ownerName ? (
                  row.isMine ? (
                    'You'
                  ) : (
                    row.ownerName
                  )
                ) : (
                  <span className="italic">Unassigned</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">{row.sourceName ?? '—'}</TableCell>
              <TableCell className="pr-4 text-right text-muted-foreground tabular-nums">
                {row.createdLabel}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
