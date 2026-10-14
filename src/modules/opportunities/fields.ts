/** Opportunity fields a stage can require before an opportunity may enter it (docs/leads.md §4.8). */
export const OPPORTUNITY_FIELD_LABELS = {
  amount: 'Value',
  expectedCloseDate: 'Expected close date',
  product: 'Product or service',
  nextStep: 'Next step',
  probability: 'Probability',
  organizationId: 'Organization',
} as const;

export type OpportunityFieldKey = keyof typeof OPPORTUNITY_FIELD_LABELS;
export const OPPORTUNITY_FIELD_KEYS = Object.keys(
  OPPORTUNITY_FIELD_LABELS,
) as OpportunityFieldKey[];

export function opportunityFieldLabel(ref: string, customLabels: Record<string, string>): string {
  if (ref.startsWith('custom:')) return customLabels[ref.slice(7)] ?? ref.slice(7);
  return OPPORTUNITY_FIELD_LABELS[ref as OpportunityFieldKey] ?? ref;
}

/** The required fields still empty on an opportunity. */
export function missingFields(
  required: string[],
  opportunity: Record<string, unknown> & { customFields?: unknown },
): string[] {
  return required.filter((ref) => {
    const value = ref.startsWith('custom:')
      ? ((opportunity.customFields ?? {}) as Record<string, unknown>)[ref.slice(7)]
      : opportunity[ref];
    if (value === null || value === undefined || value === '') return true;
    return Array.isArray(value) && value.length === 0;
  });
}
