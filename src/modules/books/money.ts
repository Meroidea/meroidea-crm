/**
 * Exact money for the books: amounts travel as decimal strings and are worked on as whole cents
 * (bigint), never as floating point (rules/coding-standards.md). Pure, shared by server and forms.
 */

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const RATE = /^\d{1,3}(\.\d{1,2})?$/;

/** "1234.5" → 123450n. Null for anything that is not a plain non-negative amount in cents. */
export function parseCents(value: string | null | undefined): bigint | null {
  const text = (value ?? '').trim();
  if (!MONEY.test(text)) return null;
  const [whole = '0', fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

/** 123450n → "1234.50"; negative amounts keep their sign. */
export function formatCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const size = cents < 0n ? -cents : cents;
  return `${sign}${size / 100n}.${String(size % 100n).padStart(2, '0')}`;
}

/** A percentage such as "10" or "10.00" in hundredths of a percent: 1000n. */
export function rateBasisPoints(rate: string | null | undefined): bigint | null {
  const text = (rate ?? '').trim();
  if (!RATE.test(text)) return null;
  const [whole = '0', fraction = ''] = text.split('.');
  const points = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return points <= 10000n ? points : null;
}

/** Non-negative division, rounded half up: the way GST is rounded on a line. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** The tax inside a tax-inclusive amount: $110 at 10% holds $10. */
export function taxInInclusive(amount: bigint, basisPoints: bigint): bigint {
  if (basisPoints === 0n) return 0n;
  return divideRounded(amount * basisPoints, 10000n + basisPoints);
}

/** The tax to add on top of a tax-exclusive amount: $100 at 10% adds $10. */
export function taxOnExclusive(amount: bigint, basisPoints: bigint): bigint {
  if (basisPoints === 0n) return 0n;
  return divideRounded(amount * basisPoints, 10000n);
}

/** Adds up decimal strings exactly. */
export function sumMoney(values: (string | null | undefined)[]): string {
  return formatCents(values.reduce((total, value) => total + toCents(value), 0n));
}

/** A stored numeric (possibly negative, possibly "12.3") as cents; 0 for empty. */
export function toCents(value: string | null | undefined): bigint {
  const text = (value ?? '').trim();
  if (text === '') return 0n;
  const negative = text.startsWith('-');
  const cents = parseCents(negative ? text.slice(1) : text);
  if (cents === null) throw new Error('not an amount');
  return negative ? -cents : cents;
}

/**
 * The first day of the financial year a date falls in. Australian businesses start in July
 * (month 7): 15 March 2027 is in the year that began 1 July 2026.
 */
export function financialYearStart(date: string, startMonth: number): string {
  const [year = 0, month = 1] = date.split('-').map(Number);
  const startYear = month >= startMonth ? year : year - 1;
  return `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
}
