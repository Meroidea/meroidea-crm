import { daysBetweenDates } from '@/lib/dates';
import { formatCalendarDate, formatMoney } from '@/lib/format';

/**
 * Payment reminders for overdue invoices (ADR-077). Written by code from the invoice's own
 * figures, never by a model: a reminder must never get an amount, a date or an invoice number
 * wrong, and nothing about a customer has to leave the system to write one. The tone steps up
 * with how late the invoice is. Pure, so it is tested directly.
 */

export type ReminderTone = 'friendly' | 'firm' | 'final';

/** Days overdue at which the tone steps up. */
export const FIRM_AFTER_DAYS = 14;
export const FINAL_AFTER_DAYS = 45;

export function toneFor(daysOverdue: number): ReminderTone {
  if (daysOverdue >= FINAL_AFTER_DAYS) return 'final';
  if (daysOverdue >= FIRM_AFTER_DAYS) return 'firm';
  return 'friendly';
}

export type ReminderDraft = {
  invoiceId: string;
  reference: string;
  customerName: string;
  customerEmail: string | null;
  balance: string;
  currency: string;
  dueDate: string;
  daysOverdue: number;
  tone: ReminderTone;
  subject: string;
  body: string;
};

/** "Olivia Example" → "Olivia"; a business name stays whole. */
function greetingName(customerName: string): string {
  const words = customerName.trim().split(/\s+/);
  return words.length === 2 ? words[0]! : customerName.trim();
}

export function writeReminder(input: {
  invoiceId: string;
  reference: string;
  customerName: string;
  customerEmail: string | null;
  balance: string;
  currency: string;
  dueDate: string;
  today: string;
  businessName: string;
  senderName: string;
}): ReminderDraft {
  const daysOverdue = Math.max(1, daysBetweenDates(input.dueDate, input.today));
  const tone = toneFor(daysOverdue);
  const amount = formatMoney(input.balance, input.currency);
  const due = formatCalendarDate(input.dueDate);
  const days = `${daysOverdue} day${daysOverdue === 1 ? '' : 's'}`;
  const hello = `Hello ${greetingName(input.customerName)},`;
  const signOff = `Kind regards,\n${input.senderName}\n${input.businessName}`;

  const versions: Record<ReminderTone, { subject: string; lines: string[] }> = {
    friendly: {
      subject: `Friendly reminder: invoice ${input.reference} for ${amount}`,
      lines: [
        hello,
        `A quick reminder that invoice ${input.reference} for ${amount} was due on ${due}. If you have already paid, thank you, and please ignore this note.`,
        'If anything on the invoice needs a second look, just reply and we will sort it out.',
      ],
    },
    firm: {
      subject: `Overdue: invoice ${input.reference} for ${amount}`,
      lines: [
        hello,
        `Invoice ${input.reference} for ${amount} is now ${days} overdue; it was due on ${due}. Please arrange payment this week, or reply to let us know when it will be paid.`,
        'If there is a problem with the invoice, please tell us so we can resolve it.',
      ],
    },
    final: {
      subject: `Final notice: invoice ${input.reference} for ${amount} is ${days} overdue`,
      lines: [
        hello,
        `Invoice ${input.reference} for ${amount} was due on ${due} and is now ${days} overdue. Please pay it within 7 days.`,
        'If we do not hear from you, we will need to discuss next steps. If you are having trouble paying, please call or reply now so we can agree a plan.',
      ],
    },
  };
  const version = versions[tone];
  return {
    invoiceId: input.invoiceId,
    reference: input.reference,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    balance: input.balance,
    currency: input.currency,
    dueDate: input.dueDate,
    daysOverdue,
    tone,
    subject: version.subject,
    body: [...version.lines, signOff].join('\n\n'),
  };
}
