'use server';

import { authedAction } from '@/server/action';

import {
  creditNoteSchema,
  invoiceIdSchema,
  recordPaymentSchema,
  saveInvoiceSchema,
} from './schemas';
import * as invoiceService from './service';

const PATHS = ['/invoices', '/books'];
const manage = { permission: 'invoices.manage', revalidate: PATHS } as const;

export const saveInvoiceAction = authedAction(
  { ...manage, input: saveInvoiceSchema },
  (ctx, input) => invoiceService.saveInvoice(ctx, input),
);
export const sendInvoiceAction = authedAction({ ...manage, input: invoiceIdSchema }, (ctx, input) =>
  invoiceService.sendInvoice(ctx, input.id),
);
export const markInvoiceSentAction = authedAction(
  { ...manage, input: invoiceIdSchema },
  (ctx, input) => invoiceService.markInvoiceSent(ctx, input.id),
);
export const markInvoicePaidAction = authedAction(
  { ...manage, input: invoiceIdSchema },
  (ctx, input) => invoiceService.markInvoicePaid(ctx, input.id),
);
export const voidInvoiceAction = authedAction({ ...manage, input: invoiceIdSchema }, (ctx, input) =>
  invoiceService.voidInvoice(ctx, input.id),
);

export const recordPaymentAction = authedAction(
  { ...manage, input: recordPaymentSchema },
  (ctx, input) => invoiceService.recordPayment(ctx, input),
);
export const voidPaymentAction = authedAction({ ...manage, input: invoiceIdSchema }, (ctx, input) =>
  invoiceService.voidPayment(ctx, input.id),
);
export const issueCreditNoteAction = authedAction(
  { ...manage, input: creditNoteSchema },
  (ctx, input) => invoiceService.issueCreditNote(ctx, input),
);
export const voidCreditNoteAction = authedAction(
  { ...manage, input: invoiceIdSchema },
  (ctx, input) => invoiceService.voidCreditNote(ctx, input.id),
);
