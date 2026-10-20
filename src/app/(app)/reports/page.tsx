import type { Metadata } from 'next';

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
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { BarList } from '@/modules/reports/components/charts';
import { ReportCsv } from '@/modules/reports/components/report-csv';
import { parseRange, ReportNav } from '@/modules/reports/components/report-nav';
import { getReports } from '@/modules/reports/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Reports' };

function pct(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
}

export default async function ReportsPage({ searchParams }: PageProps<'/reports'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'reports.view');
  const params = await searchParams;
  const range = parseRange(params.range);
  const report = await getReports(ctx, range);
  const labels = ctx.tenant.labels;
  const scope = ctx.grants.get('reports.view');
  const top = report.funnel[0]?.reached ?? 0;
  const followTotal = report.followUp.onTime + report.followUp.late;
  const canExport = hasPermission(ctx, 'reports.export');
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex w-full max-w-7xl flex-col gap-5">
      <PageHeader
        title="Reports"
        description={`Who is following up, where things stall, what's coming. ${scope === 'own' ? 'Showing your own records.' : scope === 'team' ? "Showing your team's records." : 'Showing the whole workspace.'}`}
        actions={<ReportNav page="/reports" range={range} />}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Conversion funnel</CardTitle>
            <CardDescription>
              Of {top} {labels.opportunity.plural.toLowerCase()} created in this period, how many
              reached each stage
            </CardDescription>
          </CardHeader>
          <CardContent>
            {top === 0 ? (
              <p className="text-sm text-muted-foreground">
                No {labels.opportunity.plural.toLowerCase()} created in this period.
              </p>
            ) : (
              <ol className="flex flex-col gap-2">
                {report.funnel.map((step) => (
                  <li key={step.stage} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-sm">{step.stage}</span>
                    <div className="h-7 flex-1 overflow-hidden rounded-md bg-muted">
                      <div
                        className="flex h-full items-center rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground"
                        style={{ width: `${Math.max(8, (step.reached / top) * 100)}%` }}
                      >
                        {step.reached}
                      </div>
                    </div>
                    <span className="w-12 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
                      {pct(step.reached, top)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Follow-up discipline</CardTitle>
            <CardDescription>Tasks due in this period</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['On time', report.followUp.onTime, 'text-primary'],
              ['Late', report.followUp.late, 'text-warning-text'],
              ['Overdue now', report.followUp.overdue, 'text-destructive-text'],
              ['Upcoming', report.followUp.open, 'text-muted-foreground'],
            ].map(([label, value, tone]) => (
              <div key={String(label)} className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={cn('text-2xl font-semibold tabular-nums', String(tone))}>{value}</p>
              </div>
            ))}
            <p className="col-span-full text-sm text-muted-foreground">
              {followTotal > 0 ? (
                <>
                  <span className="font-medium text-foreground">
                    {pct(report.followUp.onTime, followTotal)}
                  </span>{' '}
                  of completed follow-ups were on time.
                </>
              ) : (
                'Completed follow-ups will show here.'
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div className="flex flex-col gap-1.5">
              <CardTitle>Sources and win rate</CardTitle>
              <CardDescription>
                Where {labels.opportunity.plural.toLowerCase()} came from, and how they ended
              </CardDescription>
            </div>
            {canExport && report.bySource.length > 0 && (
              <ReportCsv
                report="sales:sources"
                fileName={`sales-sources-${range}d-${stamp}.csv`}
                rows={report.bySource.map((row) => ({
                  Source: row.name,
                  Created: row.created,
                  Won: row.won,
                  Lost: row.lost,
                  'Win rate': pct(row.won, row.won + row.lost),
                }))}
              />
            )}
          </CardHeader>
          <CardContent>
            {report.bySource.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data in this period.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                    <TableHead className="text-right">Won</TableHead>
                    <TableHead className="text-right">Lost</TableHead>
                    <TableHead className="text-right">Win rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.bySource.map((row) => (
                    <TableRow key={row.name}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.created}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.won}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.lost}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {pct(row.won, row.won + row.lost)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div className="flex flex-col gap-1.5">
              <CardTitle>By owner</CardTitle>
              <CardDescription>New and won in this period</CardDescription>
            </div>
            {canExport && report.byOwner.length > 0 && (
              <ReportCsv
                report="sales:owners"
                fileName={`sales-owners-${range}d-${stamp}.csv`}
                rows={report.byOwner.map((row) => ({
                  Owner: row.name,
                  New: row.created,
                  Won: row.won,
                  ...(report.showMoney ? { 'Won value': row.value } : {}),
                }))}
              />
            )}
          </CardHeader>
          <CardContent>
            {report.byOwner.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data in this period.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Owner</TableHead>
                    <TableHead className="text-right">New</TableHead>
                    <TableHead className="text-right">Won</TableHead>
                    {report.showMoney && <TableHead className="text-right">Won value</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.byOwner.map((row) => (
                    <TableRow key={row.name}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.created}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.won}</TableCell>
                      {report.showMoney && (
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.value, report.currency)}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Time in stage</CardTitle>
            <CardDescription>Average days per visit — where things stall</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              emptyText="Stage history builds up as deals move."
              rows={report.timeInStage.map((row) => ({
                key: row.stage,
                label: row.stage,
                value: row.avgDays,
                display: `${row.avgDays} d`,
                hint: `${row.visits} visits`,
                color: 'chart-4',
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Why deals are lost</CardTitle>
            <CardDescription>Lost in this period</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              emptyText="Nothing lost in this period."
              rows={report.lostReasons.map((row) => ({
                key: row.name,
                label: row.name,
                value: row.count,
                display: String(row.count),
                color: 'destructive',
              }))}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Activity by person</CardTitle>
            <CardDescription>
              Calls, emails, meetings and notes logged in this period
            </CardDescription>
          </CardHeader>
          <CardContent>
            {report.activityByUser.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity logged in this period.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Emails</TableHead>
                    <TableHead className="text-right">Meetings</TableHead>
                    <TableHead className="text-right">Notes & messages</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.activityByUser.map((row) => (
                    <TableRow key={row.name}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.calls}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.emails}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.meetings}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.notes}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {row.total}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
