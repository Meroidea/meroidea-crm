import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { PrintButton } from '@/components/data/print-button';
import { Badge } from '@/components/ui/badge';
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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
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
          <PrintButton />
        </div>
      </div>
      <PayslipDocument payslip={payslip} />
    </div>
  );
}
