// Money stays a decimal string end to end (coding-standards.md): this works in whole cents and
// ten-thousandths of a percent as integers, never in floating point.

const AMOUNT = /^(\d{1,12})(?:\.(\d{1,2}))?$/;
const RATE = /^(\d{1,3})(?:\.(\d{1,4}))?$/;

function toCents(amount: string): bigint | null {
  const match = AMOUNT.exec(amount);
  if (!match) return null;
  return BigInt(match[1] ?? '0') * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
}

function toRateUnits(rate: string): bigint | null {
  const match = RATE.exec(rate);
  if (!match) return null;
  return BigInt(match[1] ?? '0') * 10_000n + BigInt((match[2] ?? '').padEnd(4, '0'));
}

/**
 * An item's expected revenue from its base amount and percentage rate, e.g. a commission of
 * 15% on a tuition fee: base × rate / 100, rounded half up to the cent. Null unless both are set.
 */
export function expectedRevenueFrom(base: string | null, rate: string | null): string | null {
  if (base === null || rate === null) return null;
  const cents = toCents(base);
  const units = toRateUnits(rate);
  if (cents === null || units === null) return null;
  // cents × (rate × 10⁴) / (10⁴ × 100) gives cents; adding half the divisor rounds half up.
  const result = (cents * units + 500_000n) / 1_000_000n;
  const whole = result / 100n;
  const fraction = (result % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
}
