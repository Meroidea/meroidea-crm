import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { PrintButton } from '@/components/data/print-button';
import { zonedToday } from '@/lib/dates';
import { Badge } from '@/components/ui/badge';
import { formatCalendarDate } from '@/lib/format';
import { RaiseConcernButton } from '@/modules/concerns/components/concern-tools';
import { PayslipDocument } from '@/modules/payroll/components/payslip-document';
import { getPayslip } from '@/modules/payroll/queries';
import { hasPermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Payslip' };

export default async function PayslipPage({ params }: PageProps<'/payslips/[id]'>) {
  const ctx = await requireTenantContext();
  const parsed = z.object({ id: z.uuid() }).safeParse(await params);
  // Someone else's payslip, or a draft, is simply not found.
  const payslip = parsed.success ? await getPayslip(ctx, parsed.data.id) : null;
  if (!payslip) notFound();
  const payroll = hasPermission(ctx, 'payroll.manage');
  // The person it belongs to can ask about it; it goes to the admin, who can see pay (ADR-049).
  const canAsk = payslip.mine && hasPermission(ctx, 'concerns.raise');

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link
            href={payroll ? '/payroll' : '/payslips'}
            className="underline-offset-4 hover:underline"
          >
            {payroll ? 'Payroll' : 'My payslips'}
          </Link>{' '}
          / Payslip
        </nav>
        <div className="flex items-center gap-2">
          {payslip.status === 'draft' && (
            <Badge variant="outline">Draft — not visible to staff</Badge>
          )}
          {canAsk && (
            <RaiseConcernButton
              label="Ask about this payslip"
              variant="outline"
              preset={{
                payslipId: payslip.id,
                category: 'pay',
                raisedWith: 'admin',
                subject: `Payslip ${formatCalendarDate(payslip.periodStart)} to ${formatCalendarDate(payslip.periodEnd)}`,
              }}
            />
          )}
          <PrintButton />
        </div>
      </div>
      <PayslipDocument
        payslip={payslip}
        printedOn={zonedToday(ctx.tenant.timezone)}
        businessNumberLabel={ctx.tenant.country === 'AU' ? 'ABN' : 'Business no.'}
      />
    </div>
  );
}
