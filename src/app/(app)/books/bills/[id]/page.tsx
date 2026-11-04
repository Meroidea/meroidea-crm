import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { zonedToday } from '@/lib/dates';
import { formatCalendarDate } from '@/lib/format';
import { billNumber } from '@/modules/books/bills';
import { getBill } from '@/modules/books/bills-queries';
import { BillCreditForm, PayBillForm, VoidBillThing } from '@/modules/books/components/bill-forms';
import { SourceEntries } from '@/modules/books/components/source-entries';
import { formatAmount } from '@/modules/books/labels';
import { listAccounts, listTaxCodes } from '@/modules/books/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Bill' };

const STATUS_LABEL = { open: 'To pay', overdue: 'Overdue', paid: 'Paid', void: 'Void' } as const;

export default async function BillPage({ params }: PageProps<'/books/bills/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'books.view');
  const parsed = z.object({ id: z.uuid() }).safeParse(await params);
  const bill = parsed.success ? await getBill(ctx, parsed.data.id) : null;
  if (!bill) notFound();
  const money = (value: string) => formatAmount(value, ctx.tenant.currency);
  const canRecord = hasPermission(ctx, 'books.record');
  const live = bill.status !== 'void';
  const owing = live && bill.status !== 'paid';
  const [accounts, taxCodes] =
    canRecord && owing ? await Promise.all([listAccounts(ctx), listTaxCodes(ctx)]) : [[], []];
  const today = zonedToday(ctx.tenant.timezone);
  const hasLiveMoney =
    bill.payments.some((payment) => !payment.voided) ||
    bill.credits.some((credit) => !credit.voided);

  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/books/bills" className="underline-offset-4 hover:underline">
          Bills
        </Link>{' '}
        / {billNumber(bill.number)}
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{bill.supplierName}</h1>
            <Badge variant={bill.status === 'overdue' ? 'destructive' : 'outline'}>
              {STATUS_LABEL[bill.status]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {billNumber(bill.number)}
            {bill.supplierReference && ` · their ref ${bill.supplierReference}`} · dated{' '}
            {formatCalendarDate(bill.date)} · due {formatCalendarDate(bill.dueDate)}
          </p>
        </div>
        {canRecord && live && !hasLiveMoney && <VoidBillThing id={bill.id} kind="bill" />}
      </div>

      <Card>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Account</th>
                <th className="py-2 pr-3 font-medium">Note</th>
                <th className="py-2 pr-3 font-medium">Tax</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((line, index) => (
                <tr key={index} className="border-b border-dashed">
                  <td className="py-2 pr-3">
                    <span className="text-muted-foreground tabular-nums">{line.accountCode}</span>{' '}
                    {line.accountName}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{line.description}</td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {line.taxCode ? `${line.taxCode} (${money(line.taxAmount)})` : ''}
                  </td>
                  <td className="py-2 text-right tabular-nums">{money(line.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-right">
              <tr>
                <td colSpan={3} className="pt-2 text-muted-foreground">
                  Before GST
                </td>
                <td className="pt-2 tabular-nums">{money(bill.subtotal)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="text-muted-foreground">
                  GST
                </td>
                <td className="tabular-nums">{money(bill.taxTotal)}</td>
              </tr>
              <tr className="font-semibold">
                <td colSpan={3}>Total</td>
                <td className="tabular-nums">{money(bill.total)}</td>
              </tr>
            </tfoot>
          </table>
          {bill.notes && <p className="pt-3 text-sm text-muted-foreground">{bill.notes}</p>}
        </CardContent>
      </Card>

      {live && (
        <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">Payments and credits</h2>
            <p className="text-sm">
              Still owed <span className="font-semibold tabular-nums">{money(bill.balance)}</span>{' '}
              of {money(bill.total)}
            </p>
          </div>
          {bill.payments.length + bill.credits.length > 0 && (
            <ul className="divide-y text-sm">
              {bill.payments.map((payment) => (
                <li key={payment.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="w-28">{formatCalendarDate(payment.date)}</span>
                  <span className="flex-1">
                    Paid from {payment.accountName}
                    {payment.reference ? ` · ${payment.reference}` : ''}
                    {payment.otherBills > 0 &&
                      ` · part of ${money(payment.paymentTotal)} across ${payment.otherBills + 1} bills`}
                  </span>
                  <span className={payment.voided ? 'tabular-nums line-through' : 'tabular-nums'}>
                    {money(payment.amount)}
                  </span>
                  {payment.voided ? (
                    <span className="text-muted-foreground">Voided</span>
                  ) : (
                    canRecord && <VoidBillThing id={payment.id} kind="payment" />
                  )}
                </li>
              ))}
              {bill.credits.map((credit) => (
                <li key={credit.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="w-28">{formatCalendarDate(credit.date)}</span>
                  <span className="flex-1">
                    Supplier credit · {credit.reason}
                    {credit.supplierReference ? ` · ${credit.supplierReference}` : ''}
                  </span>
                  <span className={credit.voided ? 'tabular-nums line-through' : 'tabular-nums'}>
                    {money(credit.total)}
                  </span>
                  {credit.voided ? (
                    <span className="text-muted-foreground">Voided</span>
                  ) : (
                    canRecord && <VoidBillThing id={credit.id} kind="credit" />
                  )}
                </li>
              ))}
            </ul>
          )}
          {canRecord && owing && (
            <>
              <PayBillForm
                billId={bill.id}
                balance={bill.balance}
                supplierName={bill.supplierName}
                today={today}
                banks={accounts
                  .filter((account) => account.isBank)
                  .map((account) => ({
                    id: account.id,
                    label: `${account.code} · ${account.name}`,
                  }))}
              />
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  Record a credit from the supplier
                </summary>
                <div className="pt-3">
                  <BillCreditForm
                    billId={bill.id}
                    today={today}
                    accounts={accounts.map(
                      ({ id, code, name, type, isBank, defaultTaxCodeId }) => ({
                        id,
                        code,
                        name,
                        type,
                        isBank,
                        defaultTaxCodeId,
                      }),
                    )}
                    taxCodes={taxCodes.map(({ id, code, name, rate, appliesTo }) => ({
                      id,
                      code,
                      name,
                      rate,
                      appliesTo,
                    }))}
                    defaultAccountId={bill.lines[0]?.accountId ?? ''}
                    defaultTaxCodeId={bill.lines[0]?.taxCodeId ?? null}
                  />
                </div>
              </details>
            </>
          )}
        </section>
      )}
      <SourceEntries ctx={ctx} sourceType="bill" sourceId={bill.id} />
    </div>
  );
}
