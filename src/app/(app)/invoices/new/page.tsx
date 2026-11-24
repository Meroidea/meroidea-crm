import type { Metadata } from 'next';

import { PageHeader } from '@/components/data/page-header';
import { addDaysToDate, zonedToday } from '@/lib/dates';
import { InvoiceEditor } from '@/modules/invoices/components/invoice-tools';
import { getLastFromDetails } from '@/modules/invoices/queries';
import { DEFAULT_PAYMENT_DAYS, defaultTaxRate } from '@/modules/invoices/types';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'New invoice' };

export default async function NewInvoicePage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'invoices.manage');
  const today = zonedToday(ctx.tenant.timezone);

  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <PageHeader
        title="New invoice"
        description="Saved as a draft first. Nothing is sent until you choose to."
      />
      <InvoiceEditor
        currency={ctx.tenant.currency}
        defaults={{
          fromDetails: (await getLastFromDetails(ctx)) ?? ctx.tenant.name,
          issueDate: today,
          dueDate: addDaysToDate(today, DEFAULT_PAYMENT_DAYS),
          taxRate: defaultTaxRate(ctx.tenant.country),
        }}
      />
    </div>
  );
}
