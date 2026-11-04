'use server';

import { authedAction } from '@/server/action';

import * as bills from './bills';
import {
  archiveAccountSchema,
  billCreditSchema,
  billPaymentSchema,
  billSchema,
  booksSettingsSchema,
  exportReportSchema,
  journalSchema,
  moneySchema,
  payPayslipSchema,
  saveAccountSchema,
  saveTaxCodeSchema,
  setupBooksSchema,
  transferSchema,
  voidEntrySchema,
} from './schemas';
import * as books from './service';
import { z } from 'zod';

const PATHS = ['/books'];

export const setupBooksAction = authedAction(
  { permission: 'books.manage', input: setupBooksSchema, revalidate: PATHS },
  (ctx, input) => books.setupBooks(ctx, input),
);
export const recordMoneyAction = authedAction(
  { permission: 'books.record', input: moneySchema, revalidate: PATHS },
  (ctx, input) => books.recordMoney(ctx, input),
);
export const recordTransferAction = authedAction(
  { permission: 'books.record', input: transferSchema, revalidate: PATHS },
  (ctx, input) => books.recordTransfer(ctx, input),
);
/** The service checks `books.journal`, or `books.manage` for opening balances. */
export const recordJournalAction = authedAction(
  { permission: 'books.view', input: journalSchema, revalidate: PATHS },
  (ctx, input) => books.recordJournal(ctx, input),
);
/** The database checks the permission for the kind of entry being voided. */
export const voidEntryAction = authedAction(
  { permission: 'books.view', input: voidEntrySchema, revalidate: PATHS },
  (ctx, input) => books.voidEntry(ctx, input),
);
export const saveAccountAction = authedAction(
  { permission: 'books.manage', input: saveAccountSchema, revalidate: PATHS },
  (ctx, input) => books.saveAccount(ctx, input),
);
export const archiveAccountAction = authedAction(
  { permission: 'books.manage', input: archiveAccountSchema, revalidate: PATHS },
  (ctx, input) => books.setAccountArchived(ctx, input),
);
export const saveTaxCodeAction = authedAction(
  { permission: 'books.manage', input: saveTaxCodeSchema, revalidate: PATHS },
  (ctx, input) => books.saveTaxCode(ctx, input),
);
export const saveBooksSettingsAction = authedAction(
  { permission: 'books.manage', input: booksSettingsSchema, revalidate: PATHS },
  (ctx, input) => books.saveBooksSettings(ctx, input),
);
export const catchUpBooksAction = authedAction(
  { permission: 'books.manage', input: z.object({}), revalidate: PATHS },
  (ctx) => books.catchUpBooks(ctx),
);
export const payPayslipAction = authedAction(
  { permission: 'books.record', input: payPayslipSchema, revalidate: PATHS },
  (ctx, input) => books.payPayslip(ctx, input),
);
export const recordBooksExportAction = authedAction(
  { permission: 'books.export', input: exportReportSchema },
  (ctx, input) => books.recordBooksExport(ctx, input),
);

const idSchema = z.object({ id: z.uuid() });
const BILL_PATHS = ['/books'];

export const enterBillAction = authedAction(
  { permission: 'books.record', input: billSchema, revalidate: BILL_PATHS },
  (ctx, input) => bills.enterBill(ctx, input),
);
export const voidBillAction = authedAction(
  { permission: 'books.record', input: idSchema, revalidate: BILL_PATHS },
  (ctx, input) => bills.voidBill(ctx, input.id),
);
export const payBillsAction = authedAction(
  { permission: 'books.record', input: billPaymentSchema, revalidate: BILL_PATHS },
  (ctx, input) => bills.payBills(ctx, input),
);
export const voidBillPaymentAction = authedAction(
  { permission: 'books.record', input: idSchema, revalidate: BILL_PATHS },
  (ctx, input) => bills.voidBillPayment(ctx, input.id),
);
export const creditBillAction = authedAction(
  { permission: 'books.record', input: billCreditSchema, revalidate: BILL_PATHS },
  (ctx, input) => bills.creditBill(ctx, input),
);
export const voidBillCreditAction = authedAction(
  { permission: 'books.record', input: idSchema, revalidate: BILL_PATHS },
  (ctx, input) => bills.voidBillCredit(ctx, input.id),
);
