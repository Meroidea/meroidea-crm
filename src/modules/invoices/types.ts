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
};

export const invoiceNumber = (number: number) => `INV-${String(number).padStart(4, '0')}`;
