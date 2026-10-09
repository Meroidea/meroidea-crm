import { Building2 } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { OrganizationListRow } from '@/modules/organizations/types';

export function OrganizationsTable({
  rows,
  peopleLabel,
}: {
  rows: OrganizationListRow[];
  peopleLabel: string;
}) {
  return (
    <>
      <ul className="divide-y md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/organizations/${row.id}`}
              className="flex items-center gap-3 px-4 py-3 active:bg-accent"
            >
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"
              >
                <Building2 className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{row.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[row.city, row.country].filter(Boolean).join(', ') || 'No location'} ·{' '}
                  {row.contactCount} {peopleLabel.toLowerCase()}
                </span>
              </span>
              {row.type && (
                <Badge variant="outline" className="capitalize">
                  {row.type}
                </Badge>
              )}
            </Link>
          </li>
        ))}
      </ul>
      <Table className="hidden md:table">
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead className="pr-4 text-right">{peopleLabel}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} className="group relative">
              <TableCell className="pl-4">
                <Link
                  href={`/organizations/${row.id}`}
                  className="flex items-center gap-3 font-medium group-hover:text-primary after:absolute after:inset-0"
                >
                  <span
                    aria-hidden
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"
                  >
                    <Building2 className="size-4" />
                  </span>
                  <span className="max-w-64 truncate">{row.name}</span>
                </Link>
              </TableCell>
              <TableCell>
                {row.type ? (
                  <Badge variant="outline" className="capitalize">
                    {row.type}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {[row.city, row.country].filter(Boolean).join(', ') || '—'}
              </TableCell>
              <TableCell className="max-w-56 truncate text-muted-foreground">
                {row.email ?? '—'}
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {row.phone ?? '—'}
              </TableCell>
              <TableCell className="pr-4 text-right tabular-nums">{row.contactCount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
