import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/data/page-header';
import { zonedToday } from '@/lib/dates';
import { supplierDefaults } from '@/modules/books/bills-queries';
import { BillForm } from '@/modules/books/components/bill-forms';
import { getBooksSettings, listAccounts, listTaxCodes } from '@/modules/books/queries';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Enter a bill' };

export default async function NewBillPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'books.record');
  if (!(await getBooksSettings(ctx))) redirect('/books');
  const [accounts, taxCodes, suppliers] = await Promise.all([
    listAccounts(ctx),
    listTaxCodes(ctx),
    supplierDefaults(ctx),
  ]);
  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/books/bills" className="underline-offset-4 hover:underline">
          Bills
        </Link>{' '}
        / Enter a bill
      </nav>
      <PageHeader
        title="Enter a bill"
        description="A bill from a supplier: what it was for, and when it is due."
      />
      <BillForm
        today={zonedToday(ctx.tenant.timezone)}
        accounts={accounts.map(({ id, code, name, type, isBank, defaultTaxCodeId }) => ({
          id,
          code,
          name,
          type,
          isBank,
          defaultTaxCodeId,
        }))}
        taxCodes={taxCodes.map(({ id, code, name, rate, appliesTo }) => ({
          id,
          code,
          name,
          rate,
          appliesTo,
        }))}
        suppliers={suppliers}
        currency={ctx.tenant.currency}
      />
    </div>
  );
}
