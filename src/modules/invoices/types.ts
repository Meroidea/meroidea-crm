export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void';

export type InvoiceRow = {
  id: string;
  number: number;
  status: InvoiceStatus;
  customerName: string;
  issueDate: string;
  dueDate: string;
  total: string;
  currency: string;
  /** Sent, unpaid and past its due date. */
  overdue: boolean;
  /** What is still owed: the total less live payments and credit notes (ADR-061). */
  balance: string;
};

export type InvoiceLineRow = {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
};

export type InvoiceDetail = InvoiceRow & {
  customerEmail: string | null;
  customerAddress: string | null;
  fromDetails: string | null;
  notes: string | null;
  taxRate: string;
  subtotal: string;
  taxTotal: string;
  sentAt: Date | null;
  sentTo: string | null;
  paidAt: Date | null;
  lines: InvoiceLineRow[];
  payments: InvoicePaymentRow[];
  creditNotes: CreditNoteRow[];
};

/** A payment as it applies to one invoice: `amount` is the part of it allocated here. */
export type InvoicePaymentRow = {
  id: string;
  date: string;
  amount: string;
  paymentTotal: string;
  reference: string | null;
  payerName: string | null;
  otherInvoices: number;
  voided: boolean;
};

export type CreditNoteRow = {
  id: string;
  number: number;
  date: string;
  reason: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  voided: boolean;
};

export const invoiceNumber = (number: number) => `INV-${String(number).padStart(4, '0')}`;

export const creditNoteNumber = (number: number) => `CN-${String(number).padStart(4, '0')}`;
