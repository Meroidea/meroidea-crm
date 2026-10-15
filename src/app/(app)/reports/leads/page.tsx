import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PageHeader } from '@/components/data/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { BarList } from '@/modules/reports/components/charts';
import { ReportCsv } from '@/modules/reports/components/report-csv';
import { parseRange, ReportNav } from '@/modules/reports/components/report-nav';
import { getLeadReports } from '@/modules/reports/lead-queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Lead reports' };

function pct(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
}

const hours = (value: number | null) =>
  value === null ? '—' : value >= 48 ? `${Math.round(value / 24)} d` : `${value} h`;

type Column<T> = {
  label: string;
  value: (row: T) => string | number;
  numeric?: boolean;
};

/** One report table, with its CSV download when the viewer may export. */
function ReportTable<T>({
  title,
  description,
  rows,
  columns,
  csv,
  empty,
}: {
  title: string;
  description: ReactNode;
  rows: T[];
  columns: Column<T>[];
  csv: { report: string; fileName: string } | null;
  empty: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {csv && rows.length > 0 && (
          <ReportCsv
            report={csv.report}
            fileName={csv.fileName}
            rows={rows.map((row) =>
              Object.fromEntries(columns.map((column) => [column.label, column.value(row)])),
            )}
          />
        )}
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column.label} className={cn(column.numeric && 'text-right')}>
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={index}>
                  {columns.map((column, position) => (
                    <TableCell
                      key={column.label}
                      className={cn(
                        column.numeric && 'text-right tabular-nums',
                        position === 0 && 'font-medium',
                      )}
                    >
                      {column.value(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default async function LeadReportsPage({ searchParams }: PageProps<'/reports/leads'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'reports.view');
  const params = await searchParams;
  const range = parseRange(params.range);
  const report = await getLeadReports(ctx, range);
  const scope = ctx.grants.get('reports.view');
  const canExport = hasPermission(ctx, 'reports.export');
  const stamp = new Date().toISOString().slice(0, 10);
  const csv = (name: string) =>
    canExport
      ? { report: `leads:${name}`, fileName: `leads-${name}-${range}d-${stamp}.csv` }
      : null;
  const top = report.funnel[0]?.count ?? 0;
  const period = range === 365 ? 'the last 12 months' : `the last ${range} days`;

  const tiles = [
    {
      label: `Unassigned over ${report.sla.unassignedHours} h`,
      value: report.sla.unassignedOver,
      href: '/leads?view=queue',
    },
    {
      label: `No first contact in ${report.sla.firstContactHours} h`,
      value: report.sla.firstContactOverdue,
      href: '/leads?view=overdue',
    },
    {
      label: 'Handovers past their deadline',
      value: report.sla.acceptanceOverdue,
      href: '/leads?view=pending',
    },
    {
      label: `Quiet for ${report.sla.staleLeadDays}+ days`,
      value: report.sla.stale,
      href: '/leads?view=all',
    },
  ];

  return (
    <div className="flex w-full max-w-7xl flex-col gap-5">
      <PageHeader
        title="Lead reports"
        description={`Where leads come from, how quickly they are worked, and how handovers land. ${scope === 'own' ? 'Showing your own leads.' : scope === 'team' ? "Showing your team's leads." : 'Showing the whole workspace.'}`}
        actions={<ReportNav page="/reports/leads" range={range} />}
      />

      <section aria-label="Service levels now" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Link
            key={tile.label}
            href={tile.href}
            className="rounded-xl border bg-card p-4 transition-colors hover:border-primary/50"
          >
            <p className="text-xs text-muted-foreground">{tile.label}</p>
            <p
              className={cn(
                'text-2xl font-semibold tabular-nums',
                tile.value > 0 ? 'text-destructive-text' : 'text-primary',
              )}
            >
              {tile.value}
            </p>
          </Link>
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Lead funnel</CardTitle>
            <CardDescription>
              Of {top} leads captured in {period}, how far each got
            </CardDescription>
          </CardHeader>
          <CardContent>
            {top === 0 ? (
              <p className="text-sm text-muted-foreground">No leads captured in this period.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {report.funnel.map((step) => (
                  <li key={step.step} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 truncate text-sm">{step.step}</span>
                    <div className="h-7 flex-1 overflow-hidden rounded-md bg-muted">
                      <div
                        className="flex h-full items-center rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground"
                        style={{ width: `${Math.max(8, (step.count / top) * 100)}%` }}
                      >
                        {step.count}
                      </div>
                    </div>
                    <span className="w-12 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
                      {pct(step.count, top)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Why leads were closed</CardTitle>
              <CardDescription>Disqualified or not interested, in this period</CardDescription>
            </CardHeader>
            <CardContent>
              <BarList
                emptyText="No leads closed in this period."
                rows={report.disqualifyReasons.map((row) => ({
                  key: row.name,
                  label: row.name,
                  value: row.count,
                  display: String(row.count),
                  color: 'chart-5',
                }))}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Why handovers were returned</CardTitle>
              <CardDescription>Rejection reasons, in this period</CardDescription>
            </CardHeader>
            <CardContent>
              <BarList
                emptyText="No handovers returned in this period."
                rows={report.rejectReasons.map((row) => ({
                  key: row.name,
                  label: row.name,
                  value: row.count,
                  display: String(row.count),
                  color: 'chart-3',
                }))}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <ReportTable
        title="By source and sub-source"
        description={`Leads captured in ${period}, and how they progressed`}
        rows={report.bySource}
        csv={csv('sources')}
        empty="No leads captured in this period."
        columns={[
          { label: 'Source', value: (row) => row.source },
          { label: 'Sub-source', value: (row) => row.subSource ?? '—' },
          { label: 'Leads', value: (row) => row.created, numeric: true },
          { label: 'Contacted', value: (row) => row.contacted, numeric: true },
          { label: 'Qualified', value: (row) => row.qualified, numeric: true },
          { label: 'Converted', value: (row) => row.converted, numeric: true },
          { label: 'Won', value: (row) => row.won, numeric: true },
          { label: 'Closed', value: (row) => row.closed, numeric: true },
          { label: 'Conversion', value: (row) => pct(row.converted, row.created), numeric: true },
        ]}
      />

      <ReportTable
        title="SDR / BDR performance"
        description={`Leads captured in ${period}, by the person who worked them first`}
        rows={report.sdr}
        csv={csv('sdr')}
        empty="No leads captured in this period."
        columns={[
          { label: 'Person', value: (row) => row.name },
          { label: 'Leads', value: (row) => row.leads, numeric: true },
          { label: 'Contacted', value: (row) => row.contacted, numeric: true },
          {
            label: 'Avg to first contact',
            value: (row) => hours(row.avgHoursToFirstContact),
            numeric: true,
          },
          {
            label: `Within ${report.sla.firstContactHours} h`,
            value: (row) => pct(row.withinSla, row.leads),
            numeric: true,
          },
          { label: 'Handed over', value: (row) => row.handedOver, numeric: true },
          { label: 'Accepted', value: (row) => row.accepted, numeric: true },
          { label: 'Returned', value: (row) => row.rejected, numeric: true },
          {
            label: 'Acceptance rate',
            value: (row) => pct(row.accepted, row.accepted + row.rejected),
            numeric: true,
          },
        ]}
      />

      <ReportTable
        title="Sales rep handovers"
        description={`Handovers received and decided in ${period}, and what is waiting now`}
        rows={report.reps}
        csv={csv('reps')}
        empty="No handovers in this period."
        columns={[
          { label: 'Rep', value: (row) => row.name },
          { label: 'Received', value: (row) => row.received, numeric: true },
          { label: 'Accepted', value: (row) => row.accepted, numeric: true },
          { label: 'Returned', value: (row) => row.rejected, numeric: true },
          {
            label: 'Acceptance rate',
            value: (row) => pct(row.accepted, row.accepted + row.rejected),
            numeric: true,
          },
          {
            label: 'Avg time to decide',
            value: (row) => hours(row.avgHoursToDecide),
            numeric: true,
          },
          { label: 'Waiting now', value: (row) => row.waiting, numeric: true },
          { label: 'Past deadline', value: (row) => row.overdue, numeric: true },
        ]}
      />

      <ReportTable
        title="Leads by owner"
        description="Every lead as it stands today"
        rows={report.owners}
        csv={csv('owners')}
        empty="No leads yet."
        columns={[
          { label: 'Owner', value: (row) => row.name },
          { label: 'New', value: (row) => row.new, numeric: true },
          { label: 'Working', value: (row) => row.working, numeric: true },
          { label: 'Returned', value: (row) => row.returned, numeric: true },
          { label: 'Awaiting acceptance', value: (row) => row.pending, numeric: true },
          { label: 'Converted', value: (row) => row.converted, numeric: true },
          { label: 'Closed', value: (row) => row.closed, numeric: true },
          { label: 'Total', value: (row) => row.total, numeric: true },
        ]}
      />
    </div>
  );
}
