import 'server-only';

import { sql } from 'drizzle-orm';

import { AppError } from '@/lib/errors';
import type { Tx } from '@/server/db/with-rls';

import { ledgerCall } from './ledger-call';

/**
 * How invoices and payroll keep the books up to date (ADR-060). Each is called inside the other
 * module's own transaction, so a document and its ledger entries are saved, or refused,
 * together. While the books are switched off or not set up, nothing is posted.
 */

export type InvoiceBooksEvent = 'issued' | 'paid' | 'voided';

export async function recordInvoiceInBooks(
  tx: Tx,
  invoiceId: string,
  event: InvoiceBooksEvent,
): Promise<void> {
  await ledgerCall(tx, sql`select app.ledger_post_invoice(${invoiceId}::uuid, ${event})`);
}

export async function recordPayslipsInBooks(tx: Tx, payslipIds: string[]): Promise<void> {
  for (const id of payslipIds) {
    await ledgerCall(tx, sql`select app.ledger_post_payslip(${id}::uuid)`);
  }
}

/**
 * Refuses before something irreversible happens (an invoice emailed to a customer) if the books
 * would then refuse to record it, because the date is inside a locked period.
 */
export async function assertBooksOpenOn(tx: Tx, date: string): Promise<void> {
  const [row] = await ledgerCall<{ open: boolean }>(
    tx,
    sql`select app.ledger_open_for(${date}::date) as open`,
  );
  if (!row?.open) {
    throw new AppError(
      'CONFLICT',
      'The books are locked for this invoice date. Change the date, or ask the person who manages the books.',
    );
  }
}
