import { z } from 'zod';

// Code names never change; tenants rename objects through `tenants.labels` (docs/terminology.md).
export const LABEL_KEYS = [
  'contact',
  'organization',
  'opportunity',
  'opportunityItem',
  'partner',
  'product',
] as const;

export type LabelKey = (typeof LABEL_KEYS)[number];

export const labelSchema = z.object({
  singular: z.string().trim().min(1).max(40),
  plural: z.string().trim().min(1).max(40),
});

export type Label = z.infer<typeof labelSchema>;
export type Labels = Record<LabelKey, Label>;

export const tenantLabelsSchema = z.partialRecord(z.enum(LABEL_KEYS), labelSchema);

export const DEFAULT_LABELS: Labels = {
  contact: { singular: 'Contact', plural: 'Contacts' },
  organization: { singular: 'Organization', plural: 'Organizations' },
  opportunity: { singular: 'Opportunity', plural: 'Opportunities' },
  opportunityItem: { singular: 'Item', plural: 'Items' },
  partner: { singular: 'Partner', plural: 'Partners' },
  product: { singular: 'Product', plural: 'Products' },
};

/**
 * Merges stored tenant labels over the defaults. A malformed entry falls back to its default
 * rather than breaking every page that renders a label.
 */
export function resolveLabels(stored: unknown): Labels {
  const source =
    typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  const labels = { ...DEFAULT_LABELS };
  for (const key of LABEL_KEYS) {
    const parsed = labelSchema.safeParse(source[key]);
    if (parsed.success) labels[key] = parsed.data;
  }
  return labels;
}
