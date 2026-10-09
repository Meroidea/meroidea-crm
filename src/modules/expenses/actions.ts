'use server';

import { authedAction } from '@/server/action';

import {
  decideExpenseSchema,
  expenseIdSchema,
  startReceiptSchema,
  submitExpenseSchema,
} from './schemas';
import * as expenseService from './service';

const PATHS = ['/expenses'];
const submit = { permission: 'expenses.submit', revalidate: PATHS } as const;
const manage = { permission: 'expenses.manage', revalidate: PATHS } as const;

export const startReceiptUploadAction = authedAction(
  { permission: 'expenses.submit', input: startReceiptSchema },
  (ctx, input) => expenseService.startReceiptUpload(ctx, input),
);
export const submitExpenseAction = authedAction(
  { ...submit, input: submitExpenseSchema },
  (ctx, input) => expenseService.submitExpense(ctx, input),
);
export const withdrawExpenseAction = authedAction(
  { ...submit, input: expenseIdSchema },
  (ctx, input) => expenseService.withdrawExpense(ctx, input.id),
);
export const getReceiptUrlAction = authedAction(
  { permission: 'expenses.submit', input: expenseIdSchema },
  (ctx, input) => expenseService.getReceiptUrl(ctx, input.id),
);
export const decideExpenseAction = authedAction(
  { ...manage, input: decideExpenseSchema },
  (ctx, input) => expenseService.decideExpense(ctx, input),
);
export const markReimbursedAction = authedAction(
  { ...manage, input: expenseIdSchema },
  (ctx, input) => expenseService.markReimbursed(ctx, input.id),
);
