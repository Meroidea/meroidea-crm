/** Each signer's colour, from the theme, so fields can be told apart at a glance. */
export const SIGNER_COLOURS = [
  'border-chart-1 bg-chart-1/15 text-chart-1',
  'border-chart-5 bg-chart-5/15 text-destructive-text',
  'border-chart-4 bg-chart-4/15 text-chart-4',
  'border-warning-border bg-warning/70 text-warning-text',
  'border-chart-3 bg-chart-3/20 text-chart-1',
  'border-primary bg-primary/10 text-primary',
] as const;

export const signerColour = (index: number): string =>
  SIGNER_COLOURS[
    ((index % SIGNER_COLOURS.length) + SIGNER_COLOURS.length) % SIGNER_COLOURS.length
  ] ?? SIGNER_COLOURS[0];
