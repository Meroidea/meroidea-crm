import { Wallet } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { listMyPayslips } from '@/modules/payroll/queries';
import { formatWorked } from '@/modules/payroll/types';
import { notFound } from 'next/navigation';

import { hasFeature, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'My payslips' };

export default async function MyPayslipsPage() {
  const ctx = await requireTenantContext();
  if (!hasFeature(ctx, 'payroll')) notFound();
  const payslips = await listMyPayslips(ctx);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <PageHeader
        title="My payslips"
        description="Your pay for each period, once it has been released."
      />
      <Card>
        <CardContent>
          {payslips.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No payslips yet"
              description="A payslip appears here after each pay period is authorised and released."
            />
          ) : (
            <ul className="divide-y">
              {payslips.map((payslip) => (
                <li key={payslip.id}>
                  <Link
                    href={`/payslips/${payslip.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 transition-colors hover:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {formatCalendarDate(payslip.periodStart)} to{' '}
                        {formatCalendarDate(payslip.periodEnd)}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {formatWorked(payslip.minutes)} · paid{' '}
                        {formatCalendarDate(payslip.paymentDate)}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-semibold tabular-nums" data-sensitive>
                        {formatMoney(payslip.net, payslip.currency)}
                      </span>
                      <span className="block text-xs text-muted-foreground">net</span>
                    </span>
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
