import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/data/page-header';
import { zonedToday } from '@/lib/dates';
import { listBankOptions } from '@/modules/books/queries';
import { MultiPaymentForm } from '@/modules/invoices/components/payment-tools';
import { listOutstandingInvoices } from '@/modules/invoices/queries';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Record a payment' };

export default async function NewPaymentPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'invoices.manage');
  const [invoices, banks] = await Promise.all([listOutstandingInvoices(ctx), listBankOptions(ctx)]);
  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/invoices" className="underline-offset-4 hover:underline">
          Invoices
        </Link>{' '}
        / Record a payment
      </nav>
      <PageHeader
        title="Record a payment"
        description="One payment that settles several invoices, or part of them."
      />
      {invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sent invoice is waiting for payment.</p>
      ) : (
        <MultiPaymentForm
          invoices={invoices}
          today={zonedToday(ctx.tenant.timezone)}
          currency={ctx.tenant.currency}
          banks={banks}
        />
      )}
    </div>
  );
}
