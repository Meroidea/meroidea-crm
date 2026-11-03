import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatCalendarDate } from '@/lib/format';
import { BooksNav } from '@/modules/books/components/books-nav';
import {
  BooksSettingsForm,
  CatchUpButton,
  TaxCodeForm,
} from '@/modules/books/components/books-tools';
import { MONTHS } from '@/modules/books/labels';
import { TAX_KIND_LABELS, type TaxKind } from '@/modules/books/packs';
import { getBooksSettings, listAccounts, listTaxCodes } from '@/modules/books/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Books settings' };

export default async function BooksSettingsPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'books.view');
  const settings = await getBooksSettings(ctx);
  if (!settings) redirect('/books');
  const canManage = hasPermission(ctx, 'books.manage');
  const [accounts, taxCodes] = await Promise.all([listAccounts(ctx), listTaxCodes(ctx)]);
  const options = accounts.map(({ id, code, name, type, isBank, defaultTaxCodeId }) => ({
    id,
    code,
    name,
    type,
    isBank,
    defaultTaxCodeId,
  }));

  return (
    <div className="flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Books settings"
        description={`Country pack ${settings.countryPack} · books start ${formatCalendarDate(settings.startDate)}`}
      />
      <BooksNav current="/books/settings" />
      <Card>
        <CardContent className="flex flex-col gap-4">
          <h2 className="font-medium">Year, lock date and where invoices post</h2>
          {canManage ? (
            <BooksSettingsForm
              defaults={{
                financialYearStartMonth: settings.financialYearStartMonth,
                lockDate: settings.lockDate ?? '',
                receiptsAccountId: settings.receiptsAccountId,
                invoiceIncomeAccountId: settings.invoiceIncomeAccountId,
              }}
              banks={options.filter((account) => account.isBank)}
              incomeAccounts={options.filter((account) => account.type === 'income')}
            />
          ) : (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <dt className="text-muted-foreground">Financial year starts</dt>
              <dd>{MONTHS[settings.financialYearStartMonth - 1]}</dd>
              <dt className="text-muted-foreground">Locked up to</dt>
              <dd>{settings.lockDate ? formatCalendarDate(settings.lockDate) : 'Not locked'}</dd>
            </dl>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="space-y-1">
              <h2 className="font-medium">Opening balances</h2>
              <p className="text-sm text-muted-foreground">
                What each account held the day the books start. Any difference goes to Opening
                balances, so you do not have to make it add up by hand.
              </p>
            </div>
            <div>
              <Link
                href="/books/entries/new?kind=opening_balance"
                className="inline-flex h-8 items-center rounded-lg border px-3 text-sm font-medium hover:bg-muted"
              >
                Enter opening balances
              </Link>
            </div>
            <div className="space-y-1 pt-2">
              <h2 className="font-medium">Invoices and payslips</h2>
              <p className="text-sm text-muted-foreground">
                New ones post themselves. If the books were switched off for a while, bring in what
                was missed; nothing is ever posted twice.
              </p>
            </div>
            <CatchUpButton />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3">
          <h2 className="font-medium">Tax codes</h2>
          {canManage ? (
            <div className="flex flex-col gap-3">
              {taxCodes.map((code) => (
                <div key={code.id} className="border-b pb-3">
                  {code.systemKey && (
                    <Badge variant="outline" className="mb-2">
                      Needed by the books
                    </Badge>
                  )}
                  <TaxCodeForm
                    taxCode={{
                      id: code.id,
                      code: code.code,
                      name: code.name,
                      rate: String(Number(code.rate)),
                      kind: code.kind as TaxKind,
                      appliesTo: code.appliesTo as 'sales' | 'purchases' | 'both',
                    }}
                  />
                </div>
              ))}
              <h3 className="pt-2 text-sm font-medium">Add a tax code</h3>
              <TaxCodeForm />
            </div>
          ) : (
            <ul className="divide-y text-sm">
              {taxCodes.map((code) => (
                <li key={code.id} className="flex justify-between py-2">
                  <span>{code.name}</span>
                  <span className="text-muted-foreground">
                    {Number(code.rate)}% · {TAX_KIND_LABELS[code.kind as TaxKind]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
