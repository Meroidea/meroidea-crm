/**
 * Calling codes for the default countries our workspaces are set up with. Enough to turn a
 * national number ("0412 345 678") into a comparable form for duplicate detection.
 * TODO(dependency approval): replace with libphonenumber-js for full validation per country.
 */
const CALLING_CODES: Record<string, string> = {
  AU: '61',
  NZ: '64',
  GB: '44',
  IE: '353',
  US: '1',
  CA: '1',
  IN: '91',
  NP: '977',
  BD: '880',
  PK: '92',
  LK: '94',
  PH: '63',
  VN: '84',
  CN: '86',
  SG: '65',
  MY: '60',
  ID: '62',
  AE: '971',
};

/**
 * Best-effort E.164 ("+61412345678"). Returns null when the input has too few digits to be a
 * phone number, so a typo never counts as a duplicate of another typo.
 */
export function normalizePhone(
  raw: string | null | undefined,
  defaultCountry: string | null,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (digits.length < 6) return null;

  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;

  const code = defaultCountry ? CALLING_CODES[defaultCountry.toUpperCase()] : undefined;
  if (!code) return `+${digits}`;
  if (digits.startsWith(code) && digits.length > 10) return `+${digits}`;
  // Most countries write national numbers with a trunk prefix 0 that E.164 drops.
  if (digits.startsWith('0')) digits = digits.slice(1);
  return `+${code}${digits}`;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase();
  return value ? value : null;
}
