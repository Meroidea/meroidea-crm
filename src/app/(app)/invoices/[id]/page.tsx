import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PrintButton } from '@/components/data/print-button';
import { Badge } from '@/components/ui/badge';
import { zonedToday } from '@/lib/dates';
import { formatCalendarDate, formatDateTime, formatMoney } from '@/lib/format';
import { listBankOptions } from '@/modules/books/queries';
import { SourceEntries } from '@/modules/books/components/source-entries';
import { InvoiceDocument } from '@/modules/invoices/components/invoice-document';
import { InvoiceActions, InvoiceEditor } from '@/modules/invoices/components/invoice-tools';
import {
  CreditNoteForm,
  RecordPaymentForm,
  VoidMoneyButton,
} from '@/modules/invoices/components/payment-tools';
import { getInvoice } from '@/modules/invoices/queries';
import { invoiceIdSchema } from '@/modules/invoices/schemas';
import { creditNoteNumber, invoiceNumber } from '@/modules/invoices/types';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Invoice' };

export default async function InvoicePage({ params, searchParams }: PageProps<'/invoices/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'invoices.manage');
  const parsed = invoiceIdSchema.safeParse(await params);
  const invoice = parsed.success ? await getInvoice(ctx, parsed.data.id) : null;
  if (!invoice) notFound();
  const editing = invoice.status === 'draft' && (await searchParams).edit === '1';
  const partPaid = invoice.status === 'sent' && invoice.balance !== invoice.total;
  const label = invoice.overdue
    ? 'Overdue'
    : partPaid
      ? 'Part paid'
      : { draft: 'Draft', sent: 'Sent', paid: 'Paid', void: 'Void' }[invoice.status];

  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <div className="no-print">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link href="/invoices" className="underline-offset-4 hover:underline">
            Invoices
          </Link>{' '}
          / {invoiceNumber(invoice.number)}
        </nav>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {invoiceNumber(invoice.number)}
            </h1>
            <Badge variant={invoice.overdue ? 'destructive' : 'outline'}>{label}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {invoice.status === 'draft' && !editing && (
              <Link
                href={`/invoices/${invoice.id}?edit=1`}
                className="inline-flex h-8 items-center rounded-lg border px-3 text-sm font-medium hover:bg-muted"
              >
                Edit draft
              </Link>
            )}
            <PrintButton />
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {invoice.status === 'draft' && 'Not sent yet. You can still change anything.'}
          {invoice.status === 'sent' &&
            `Sent ${formatDateTime(ctx, invoice.sentAt)}${invoice.sentTo ? ` to ${invoice.sentTo}` : ''}.`}
          {invoice.status === 'paid' && `Paid ${formatDateTime(ctx, invoice.paidAt)}.`}
          {invoice.status === 'void' && 'Void: kept on record, no longer owed.'}
        </p>
      </div>

      {editing ? (
        <InvoiceEditor
          invoice={invoice}
          currency={invoice.currency}
          defaults={{
            fromDetails: '',
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            taxRate: '0',
          }}
        />
      ) : (
        <>
          <InvoiceActions id={invoice.id} status={invoice.status} />
          {(invoice.status === 'sent' || invoice.status === 'paid') && (
            <section className="no-print flex flex-col gap-4 rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-medium">Payments and credits</h2>
                <p className="text-sm">
                  Still owed{' '}
                  <span className="font-semibold tabular-nums">
                    {formatMoney(invoice.balance, invoice.currency)}
                  </span>{' '}
                  of {formatMoney(invoice.total, invoice.currency)}
                </p>
              </div>
              {invoice.payments.length + invoice.creditNotes.length > 0 && (
                <ul className="divide-y text-sm">
                  {invoice.payments.map((payment) => (
                    <li
                      key={payment.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                    >
                      <span className="w-28">{formatCalendarDate(payment.date)}</span>
                      <span className="flex-1">
                        Payment{payment.reference ? ` · ${payment.reference}` : ''}
                        {payment.otherInvoices > 0 &&
                          ` · part of ${formatMoney(payment.paymentTotal, invoice.currency)} across ${payment.otherInvoices + 1} invoices`}
                      </span>
                      <span
                        className={payment.voided ? 'tabular-nums line-through' : 'tabular-nums'}
                      >
                        {formatMoney(payment.amount, invoice.currency)}
                      </span>
                      {payment.voided ? (
                        <span className="text-muted-foreground">Voided</span>
                      ) : (
                        <VoidMoneyButton id={payment.id} kind="payment" />
                      )}
                    </li>
                  ))}
                  {invoice.creditNotes.map((credit) => (
                    <li
                      key={credit.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                    >
                      <span className="w-28">{formatCalendarDate(credit.date)}</span>
                      <span className="flex-1">
                        {creditNoteNumber(credit.number)} · {credit.reason}
                      </span>
                      <span
                        className={credit.voided ? 'tabular-nums line-through' : 'tabular-nums'}
                      >
                        {formatMoney(credit.total, invoice.currency)}
                      </span>
                      {credit.voided ? (
                        <span className="text-muted-foreground">Voided</span>
                      ) : (
                        <VoidMoneyButton id={credit.id} kind="credit" />
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {invoice.status === 'sent' && (
                <>
                  <RecordPaymentForm
                    invoiceId={invoice.id}
                    balance={invoice.balance}
                    customerName={invoice.customerName}
                    today={zonedToday(ctx.tenant.timezone)}
                    banks={await listBankOptions(ctx)}
                  />
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">Give a credit</summary>
                    <div className="pt-3">
                      <CreditNoteForm
                        invoiceId={invoice.id}
                        today={zonedToday(ctx.tenant.timezone)}
                      />
                    </div>
                  </details>
                </>
              )}
            </section>
          )}
          <InvoiceDocument invoice={invoice} sellerName={ctx.tenant.name} />
          <SourceEntries ctx={ctx} sourceType="invoice" sourceId={invoice.id} />
        </>
      )}
    </div>
  );
}
