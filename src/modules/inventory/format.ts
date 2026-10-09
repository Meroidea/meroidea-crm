/** "12.500" → "12.5", "3.000" → "3". String work only, so no precision is lost. */
export function formatQuantity(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

/** "+5", "-2.5": a ledger change with its sign always shown. */
export function formatDelta(value: string): string {
  const plain = formatQuantity(value.replace(/^-/, ''));
  return value.startsWith('-') ? `−${plain}` : `+${plain}`;
}

export const MOVEMENT_TYPE_LABELS = {
  received: 'Received',
  used: 'Used',
  wasted: 'Wasted',
  adjusted: 'Correction',
  stocktake: 'Stocktake',
} as const;
