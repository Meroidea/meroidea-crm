/** Check-digit and format rules for Australian identifiers. Pure; safe on client and server. */

const digitsOf = (value: string) => value.replace(/[\s-]/g, '');

const weightedSum = (digits: string, weights: number[]) =>
  [...digits].reduce((sum, digit, index) => sum + Number(digit) * (weights[index] ?? 0), 0);

/** Tax file number: eight or nine digits with a modulus-11 check. */
export function isValidTaxFileNumber(value: string): boolean {
  const digits = digitsOf(value);
  if (/^\d{9}$/.test(digits)) return weightedSum(digits, [1, 4, 3, 7, 5, 8, 6, 9, 10]) % 11 === 0;
  if (/^\d{8}$/.test(digits)) return weightedSum(digits, [10, 7, 8, 4, 6, 3, 5, 1]) % 11 === 0;
  return false;
}

/** Australian Business Number: eleven digits with a modulus-89 check. */
export function isValidAbn(value: string): boolean {
  const digits = digitsOf(value);
  if (!/^\d{11}$/.test(digits)) return false;
  const shifted = `${Number(digits[0]) - 1}${digits.slice(1)}`;
  return weightedSum(shifted, [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]) % 89 === 0;
}

export const isValidBsb = (value: string) => /^\d{6}$/.test(digitsOf(value));
export const isValidBankAccount = (value: string) => /^\d{4,10}$/.test(digitsOf(value));

export const normalizeDigits = digitsOf;

/** "••• ••• 782": enough to recognise a number, never enough to use it. */
export function maskTail(value: string, visible = 3): string {
  const digits = digitsOf(value);
  return `${'•'.repeat(Math.max(0, digits.length - visible))}${digits.slice(-visible)}`;
}
