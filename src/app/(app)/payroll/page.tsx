import { Banknote } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatCalendarDate } from '@/lib/format';
import { listPayRuns } from '@/modules/payroll/queries';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Payroll' };

export default async function PayrollPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'payroll.manage');
  const runs = await listPayRuns(ctx);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Payroll"
        description="Authorise each roster’s worked hours, add tax, and release payslips to staff."
      />
      <p className="rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-text">
        Payslips here are hours × the contract’s hourly rate, plus super. Tax is not calculated: you
        enter the amount withheld. Penalty rates, overtime, allowances and leave are not applied.
      </p>
      <Card>
        <CardContent>
          {runs.length === 0 ? (
            <EmptyState
              icon={Banknote}
              title="No published rosters yet"
              description="Publish a roster first. Once its week or fortnight has been worked, authorise it here."
            />
          ) : (
            <ul className="divide-y">
              {runs.map((run) => (
                <li key={run.id}>
                  <Link
                    href={`/payroll/${run.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 transition-colors hover:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1 font-medium">
                      {formatCalendarDate(run.startsOn)} to {formatCalendarDate(run.endsOn)}
                    </span>
                    {!run.authorisedAt ? (
                      <Badge
                        variant="outline"
                        className="border-warning-border bg-warning text-warning-text"
                      >
                        Waiting to be authorised
                      </Badge>
                    ) : run.released === run.payslips && run.payslips > 0 ? (
                      <Badge>Released · {run.payslips}</Badge>
                    ) : (
                      <Badge variant="secondary">
                        {run.payslips} draft {run.payslips === 1 ? 'payslip' : 'payslips'}
                      </Badge>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
