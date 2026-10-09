'use server';

import { authedAction } from '@/server/action';

import { invoiceIdSchema, saveInvoiceSchema } from './schemas';
import * as invoiceService from './service';

const PATHS = ['/invoices'];
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
