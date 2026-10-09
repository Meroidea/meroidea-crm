import 'server-only';

import { formatCalendarDate, formatMoney } from '@/lib/format';
import { isEmailConfigured, sendEmail } from '@/server/email';

import { orderNumber, type OrderLineRow } from './types';

/**
 * How an order reaches a supplier. Email is the only channel today. A supplier that takes orders
 * through its own API gets a channel of its own here: implement `OrderChannel` against that API,
 * add it to CHANNELS, and set `suppliers.order_channel` to its key. Nothing else in purchasing
 * needs to change, because placing an order only ever talks to this interface.
 */

export type OrderDocument = {
  number: number;
  buyerName: string;
  /** Who placed it, for the supplier to reply to. */
  buyerEmail: string;
  supplierName: string;
  accountNumber: string | null;
  orderEmail: string | null;
  deliveryDate: string;
  notes: string | null;
  currency: string;
  total: string;
  lines: OrderLineRow[];
};

export type ChannelResult =
  { sent: true; sentTo: string; externalReference?: string } | { sent: false; reason: string };

export interface OrderChannel {
  label: string;
  /** What is missing before this supplier can be ordered from this way, or null when ready. */
  missing(supplier: { orderEmail: string | null }): string | null;
  send(order: OrderDocument): Promise<ChannelResult>;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const trimQuantity = (value: string) =>
  value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;

/** The order as an email: plain text for every client, with an HTML table alongside. */
export function renderOrderEmail(order: OrderDocument): {
  subject: string;
  text: string;
  html: string;
} {
  const reference = orderNumber(order.number);
  const delivery = formatCalendarDate(order.deliveryDate);
  const subject = `Order ${reference} from ${order.buyerName} for delivery ${delivery}`;
  const describe = (line: OrderLineRow) =>
    [line.code, line.name, line.unit ? `(${line.unit})` : null].filter(Boolean).join(' ');

  const text = [
    `Hello ${order.supplierName},`,
    `Please supply the following for delivery on ${delivery}.`,
    order.accountNumber ? `Account: ${order.accountNumber}` : null,
    order.lines.map((line) => `${trimQuantity(line.quantity)} x ${describe(line)}`).join('\n'),
    order.notes ? `Notes: ${order.notes}` : null,
    `Order reference: ${reference}`,
    `Please reply to this email to confirm, or if anything is unavailable.`,
    `Thank you,\n${order.buyerName}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const cell = 'padding:6px 12px 6px 0;border-bottom:1px solid #e5e7eb;text-align:left';
  const rows = order.lines
    .map(
      (line) =>
        `<tr><td style="${cell}">${escapeHtml(trimQuantity(line.quantity))}</td><td style="${cell}">${escapeHtml(line.code ?? '')}</td><td style="${cell}">${escapeHtml(line.name)}</td><td style="${cell}">${escapeHtml(line.unit ?? '')}</td></tr>`,
    )
    .join('');
  const html = `<p>Hello ${escapeHtml(order.supplierName)},</p>
<p>Please supply the following for delivery on <strong>${escapeHtml(delivery)}</strong>.</p>
${order.accountNumber ? `<p>Account: ${escapeHtml(order.accountNumber)}</p>` : ''}
<table style="border-collapse:collapse;font-size:14px"><thead><tr><th style="${cell}">Qty</th><th style="${cell}">Code</th><th style="${cell}">Item</th><th style="${cell}">Unit</th></tr></thead><tbody>${rows}</tbody></table>
${order.notes ? `<p>Notes: ${escapeHtml(order.notes)}</p>` : ''}
<p>Order reference: ${reference}<br>Estimated total at your listed prices: ${escapeHtml(formatMoney(order.total, order.currency))}</p>
<p>Please reply to this email to confirm, or if anything is unavailable.</p>
<p>Thank you,<br>${escapeHtml(order.buyerName)}</p>`;
  return { subject, text, html };
}

const emailChannel: OrderChannel = {
  label: 'Email',
  missing: (supplier) =>
    supplier.orderEmail ? null : 'Add the email address this supplier takes orders at.',
  async send(order) {
    if (!order.orderEmail)
      return { sent: false, reason: 'This supplier has no order email address.' };
    if (!isEmailConfigured()) {
      return { sent: false, reason: 'Email sending is not set up for this system yet.' };
    }
    const result = await sendEmail({
      to: order.orderEmail,
      replyTo: order.buyerEmail || undefined,
      ...renderOrderEmail(order),
    });
    return result.sent
      ? { sent: true, sentTo: order.orderEmail }
      : { sent: false, reason: 'The email could not be sent. Try sending it again.' };
  },
};

export const CHANNELS: Record<string, OrderChannel> = { email: emailChannel };

export const channelFor = (key: string): OrderChannel => CHANNELS[key] ?? emailChannel;
