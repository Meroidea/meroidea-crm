import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { PageHeader } from '@/components/data/page-header';
import { zonedToday } from '@/lib/dates';
import { JournalForm, MoneyForm, TransferForm } from '@/modules/books/components/entry-forms';
import { getBooksSettings, listAccounts, listTaxCodes } from '@/modules/books/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'New transaction' };

const kindSchema = z
  .object({
    kind: z
      .enum(['money_in', 'money_out', 'transfer', 'journal', 'opening_balance'])
      .catch('money_in'),
  })
  .catch({ kind: 'money_in' });

const TITLES = {
  money_in: ['Money in', 'Money the business received that did not come from an invoice.'],
  money_out: ['Money out', 'A purchase, bill, fee or direct debit paid from a bank or card.'],
  transfer: ['Transfer', 'Money moved between your own accounts.'],
  journal: ['Journal', 'Debits and credits, for adjustments and corrections.'],
  opening_balance: [
    'Opening balances',
    'What each account held on the day the books start. Any difference goes to Opening balances.',
  ],
} as const;

export default async function NewEntryPage({ searchParams }: PageProps<'/books/entries/new'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'books.view');
  const { kind } = kindSchema.parse(await searchParams);
  requirePermission(
    ctx,
    kind === 'journal'
      ? 'books.journal'
      : kind === 'opening_balance'
        ? 'books.manage'
        : 'books.record',
  );
  const settings = await getBooksSettings(ctx);
  if (!settings) redirect('/books');
  const [accounts, taxCodes] = await Promise.all([listAccounts(ctx), listTaxCodes(ctx)]);
  const today = zonedToday(ctx.tenant.timezone);
  const options = accounts.map(({ id, code, name, type, isBank, defaultTaxCodeId }) => ({
    id,
    code,
    name,
    type,
    isBank,
    defaultTaxCodeId,
  }));
  const [title, description] = TITLES[kind];

  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/books" className="underline-offset-4 hover:underline">
          Books
        </Link>{' '}
        / {title}
      </nav>
      <PageHeader title={title} description={description} />
      {(kind === 'money_in' || kind === 'money_out') && (
        <MoneyForm
          kind={kind}
          today={today}
          accounts={options}
          taxCodes={taxCodes.map(({ id, code, name, rate, appliesTo }) => ({
            id,
            code,
            name,
            rate,
            appliesTo,
          }))}
          currency={ctx.tenant.currency}
        />
      )}
      {kind === 'transfer' && <TransferForm today={today} accounts={options} />}
      {(kind === 'journal' || kind === 'opening_balance') && (
        <JournalForm
          kind={kind}
          today={kind === 'opening_balance' ? settings.startDate : today}
          accounts={options}
          currency={ctx.tenant.currency}
          canAdjust={hasPermission(ctx, 'books.journal')}
        />
      )}
    </div>
  );
}
