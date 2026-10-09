const ALLOWED = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'info',
  'positive',
  'destructive',
  'primary',
];

/** Theme token for a stage colour key; never a raw colour (docs/design-system.md). */
export function stageColorVar(color: string | null): string {
  const key = color && ALLOWED.includes(color) ? color : 'primary';
  if (key === 'positive') return 'var(--positive-text)';
  return `var(--${key})`;
}
