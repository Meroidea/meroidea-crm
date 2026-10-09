import { describe, expect, it } from 'vitest';

import { DEFAULT_LABELS, resolveLabels } from '@/lib/tenant/labels';

describe('resolveLabels', () => {
  it('uses the industry-neutral defaults when a tenant has no labels', () => {
    expect(resolveLabels({})).toEqual(DEFAULT_LABELS);
    expect(resolveLabels(null)).toEqual(DEFAULT_LABELS);
  });

  it('applies a tenant rename and keeps defaults for everything else', () => {
    const labels = resolveLabels({ contact: { singular: 'Buyer', plural: 'Buyers' } });

    expect(labels.contact).toEqual({ singular: 'Buyer', plural: 'Buyers' });
    expect(labels.opportunity).toEqual(DEFAULT_LABELS.opportunity);
  });

  it('falls back to the default for a malformed entry instead of failing', () => {
    const labels = resolveLabels({
      contact: { singular: '' },
      opportunity: 'Deal',
      partner: { singular: '  Referrer ', plural: 'Referrers' },
    });

    expect(labels.contact).toEqual(DEFAULT_LABELS.contact);
    expect(labels.opportunity).toEqual(DEFAULT_LABELS.opportunity);
    expect(labels.partner).toEqual({ singular: 'Referrer', plural: 'Referrers' });
  });

  it('ignores keys that are not part of the label catalog', () => {
    expect(resolveLabels({ invoice: { singular: 'Bill', plural: 'Bills' } })).toEqual(
      DEFAULT_LABELS,
    );
  });
});
