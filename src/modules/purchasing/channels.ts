import 'server-only';

import { formatCalendarDate, formatMoney } from '@/lib/format';
import { isEmailConfigured, sendEmail } from '@/server/email';

import { orderNumber, type OrderLineRow } from './types';
import { renderEmail } from '@/server/email-template';

/**
 * How an order reaches a supplier. Email is the only channel today. A supplier that takes orders
 * through its own API gets a channel of its own here: implement `OrderChannel` against that API,
 * add it to CHANNELS, and set `suppliers.order_channel` to its key. Nothing else in purchasing
 * needs to change, because placing an order only ever talks to this interface.
 */

export type OrderDocument = {
  number: number;
  buyerName: string;
  /** The buying business's own colour, when it has one. */
  buyerColor?: string | null;
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

  const email = renderEmail({
    sender: { kind: 'business', name: order.buyerName, color: order.buyerColor },
    preheader: `${order.lines.length} ${order.lines.length === 1 ? 'item' : 'items'} for delivery on ${delivery}.`,
    heading: `Order ${reference}`,
    blocks: [
      { type: 'paragraph', text: `Hello ${order.supplierName},` },
      { type: 'paragraph', text: `Please supply the following for delivery on ${delivery}.` },
      {
        type: 'details',
        rows: [
          { label: 'Order reference', value: reference },
          { label: 'Delivery', value: delivery },
          ...(order.accountNumber ? [{ label: 'Account', value: order.accountNumber }] : []),
        ],
      },
      {
        type: 'table',
        columns: ['Qty', 'Code', 'Item', 'Unit'],
        rows: order.lines.map((line) => [
          trimQuantity(line.quantity),
          line.code ?? '',
          line.name,
          line.unit ?? '',
        ]),
        textRows: order.lines.map((line) => `${trimQuantity(line.quantity)} x ${describe(line)}`),
        totals: [
          {
            label: 'Estimated total at your listed prices',
            value: formatMoney(order.total, order.currency),
          },
        ],
        totalsInText: false,
      },
      ...(order.notes ? [{ type: 'message' as const, text: `Notes: ${order.notes}` }] : []),
      {
        type: 'paragraph',
        text: 'Please reply to this email to confirm, or to tell us if anything is unavailable.',
      },
    ],
    signature: ['Thank you,', order.buyerName],
    reason: `You received this order from ${order.buyerName}. Replies go straight to the person who placed it.`,
  });
  return { subject, ...email };
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
