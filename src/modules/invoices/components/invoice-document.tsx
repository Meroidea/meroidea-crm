import { formatCalendarDate, formatMoney } from '@/lib/format';
import { invoiceNumber, type InvoiceDetail } from '@/modules/invoices/types';

/** The invoice as the customer sees it; also what gets printed. */
export function InvoiceDocument({
  invoice,
  sellerName,
}: {
  invoice: InvoiceDetail;
  sellerName: string;
}) {
  const money = (value: string) => formatMoney(value, invoice.currency);
  const taxed = Number(invoice.taxRate) > 0;
  return (
    <article className="rounded-xl border bg-card p-6 sm:p-10 print:border-0 print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-2xl font-semibold tracking-tight">
            {taxed ? 'Tax invoice' : 'Invoice'}
          </p>
          <p className="mt-1 text-muted-foreground tabular-nums">{invoiceNumber(invoice.number)}</p>
        </div>
        <p className="max-w-xs text-right text-sm whitespace-pre-line">
          {invoice.fromDetails ?? sellerName}
        </p>
      </header>

      <div className="mt-8 grid gap-6 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Billed to
          </p>
          <p className="mt-1.5 font-medium" data-sensitive>
            {invoice.customerName}
          </p>
          {invoice.customerAddress && (
            <p className="whitespace-pre-line text-muted-foreground" data-sensitive>
              {invoice.customerAddress}
            </p>
          )}
          {invoice.customerEmail && (
            <p className="text-muted-foreground" data-sensitive>
              {invoice.customerEmail}
            </p>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-y-1 sm:justify-self-end">
          <dt className="text-muted-foreground">Invoice date</dt>
          <dd className="text-right font-medium">{formatCalendarDate(invoice.issueDate)}</dd>
          <dt className="text-muted-foreground">Due date</dt>
          <dd className="text-right font-medium">{formatCalendarDate(invoice.dueDate)}</dd>
        </dl>
      </div>

      <table className="mt-8 w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="py-2 font-medium">
              Description
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Qty
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Price
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Amount
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {invoice.lines.map((line) => (
            <tr key={line.id}>
              <td className="py-2.5 pr-4">{line.description}</td>
              <td className="py-2.5 text-right tabular-nums">{Number(line.quantity)}</td>
              <td className="py-2.5 text-right tabular-nums">{money(line.unitPrice)}</td>
              <td className="py-2.5 text-right tabular-nums">{money(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="mt-4 ml-auto grid w-full max-w-xs grid-cols-2 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="text-right tabular-nums">{money(invoice.subtotal)}</dd>
        {taxed && (
          <>
            <dt className="text-muted-foreground">Tax ({Number(invoice.taxRate)}%)</dt>
            <dd className="text-right tabular-nums">{money(invoice.taxTotal)}</dd>
          </>
        )}
        <dt className="border-t pt-2 font-semibold">Total due</dt>
        <dd className="border-t pt-2 text-right text-lg font-semibold tabular-nums">
          {money(invoice.total)}
        </dd>
      </dl>

      {invoice.notes && (
        <p className="mt-8 text-sm whitespace-pre-line text-muted-foreground">{invoice.notes}</p>
      )}
    </article>
  );
}
