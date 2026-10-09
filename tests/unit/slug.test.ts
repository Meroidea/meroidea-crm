import { describe, expect, it } from 'vitest';

import { isValidSlug, slugify, uniqueSlug } from '@/lib/tenant/slug';

describe('slugify', () => {
  it('turns a company name into a workspace address', () => {
    expect(slugify('Harbour Logistics')).toBe('harbour-logistics');
    expect(slugify('  Açme & Co.  ')).toBe('acme-co');
    expect(slugify('Beacon—Health')).toBe('beacon-health');
  });

  it('never leaves a trailing separator or exceeds the length limit', () => {
    const slug = slugify('A'.repeat(60));
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('isValidSlug', () => {
  it('refuses reserved addresses', () => {
    expect(isValidSlug('admin')).toBe(false);
    expect(isValidSlug('meroidea')).toBe(false);
    expect(isValidSlug('harbour-logistics')).toBe(true);
  });
});

describe('uniqueSlug', () => {
  it('suffixes a collision rather than failing the sign-up', async () => {
    const taken = new Set(['acme', 'acme-2']);
    await expect(uniqueSlug('Acme', async (c) => taken.has(c))).resolves.toBe('acme-3');
  });

  it('pads a name too short to be a valid address', async () => {
    await expect(uniqueSlug('Ox', async () => false)).resolves.toBe('ox-workspace');
  });

  it('falls back to something usable when the name has no usable characters', async () => {
    await expect(uniqueSlug('!!!', async () => false)).resolves.toBe('workspace');
  });
});
