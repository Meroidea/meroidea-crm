import type { EntryKind } from './schemas';

/** Plain words first (ADR-060): "Money in", not "Debit bank". */
export const ENTRY_KIND_LABELS: Record<EntryKind, string> = {
  money_in: 'Money in',
  money_out: 'Money out',
  transfer: 'Transfer',
  journal: 'Journal',
  opening_balance: 'Opening balances',
  invoice: 'Invoice',
  invoice_payment: 'Invoice payment',
  payslip: 'Pay run',
  payslip_payment: 'Wages paid',
  reversal: 'Reversal',
};

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Amounts in the books always show cents, and negatives in brackets the way accountants read
 * them. Display only: arithmetic stays in cents (money.ts).
 */
export function formatAmount(amount: string | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const value = Number(amount);
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    currencySign: 'accounting',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
