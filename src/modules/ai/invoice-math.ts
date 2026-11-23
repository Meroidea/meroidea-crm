import { formatCents, parseCents, rateBasisPoints, taxOnExclusive } from '@/modules/books/money';

/**
 * Totals for an invoice preview, worked out exactly as the database will when the draft is saved
 * (invoices/service.ts): each line rounded to the cent, half up, then tax on the subtotal. The
 * database recalculates on save, so a preview can never set what is charged.
 */

const QUANTITY = /^\d{1,7}(\.\d{1,3})?$/;

/** "1.5" → 1500n (thousandths). Null when not a plain quantity. */
function parseMilli(value: string): bigint | null {
  if (!QUANTITY.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
}

export function lineTotal(quantity: string, unitPrice: string): string | null {
  const milli = parseMilli(quantity);
  const cents = parseCents(unitPrice);
  if (milli === null || cents === null) return null;
  return formatCents((cents * milli * 2n + 1000n) / 2000n);
}

export function invoiceTotals(
  lines: { quantity: string; unitPrice: string }[],
  taxRate: string,
): { subtotal: string; taxTotal: string; total: string } | null {
  const points = rateBasisPoints(taxRate);
  if (points === null) return null;
  let subtotal = 0n;
  for (const line of lines) {
    const total = lineTotal(line.quantity, line.unitPrice);
    if (total === null) return null;
    subtotal += parseCents(total)!;
  }
  const tax = taxOnExclusive(subtotal, points);
  return {
    subtotal: formatCents(subtotal),
    taxTotal: formatCents(tax),
    total: formatCents(subtotal + tax),
  };
}

/** A number from the model as a decimal string with at most `places` decimals, or null. */
export function decimalString(value: number, places: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const fixed = value.toFixed(places);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') || '0' : fixed;
}
