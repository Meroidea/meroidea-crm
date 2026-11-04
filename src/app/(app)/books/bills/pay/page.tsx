import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/data/page-header';
import { zonedToday } from '@/lib/dates';
import { listBills } from '@/modules/books/bills-queries';
import { PayBillsForm } from '@/modules/books/components/bill-forms';
import { getBooksSettings, listAccounts } from '@/modules/books/queries';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Pay bills' };

export default async function PayBillsPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'books.record');
  if (!(await getBooksSettings(ctx))) redirect('/books');
  const [bills, accounts] = await Promise.all([
    listBills(ctx, { status: 'open' }),
    listAccounts(ctx),
  ]);
  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/books/bills" className="underline-offset-4 hover:underline">
          Bills
        </Link>{' '}
        / Pay bills
      </nav>
      <PageHeader
        title="Pay bills"
        description="One payment that settles several bills, or parts of them."
      />
      {bills.length === 0 ? (
        <p className="text-sm text-muted-foreground">No bill is waiting to be paid.</p>
      ) : (
        <PayBillsForm
          bills={bills}
          today={zonedToday(ctx.tenant.timezone)}
          currency={ctx.tenant.currency}
          banks={accounts
            .filter((account) => account.isBank)
            .map((account) => ({ id: account.id, label: `${account.code} · ${account.name}` }))}
        />
      )}
    </div>
  );
}
