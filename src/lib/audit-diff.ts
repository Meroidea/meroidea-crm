const MASK = '•••';

/**
 * The {field: [old, new]} shape stored in audit_logs.changes. Only fields that actually
 * changed are kept; sensitive fields record *that* they changed, never the values.
 */
export function diffChanges<T extends Record<string, unknown>>(
  before: Partial<T>,
  after: Partial<T>,
  sensitive: readonly (keyof T)[] = [],
): Record<string, [unknown, unknown]> {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const key of Object.keys(after) as (keyof T & string)[]) {
    const previous = before[key] ?? null;
    const next = after[key] ?? null;
    if (JSON.stringify(previous) === JSON.stringify(next)) continue;
    changes[key] = sensitive.includes(key) ? [MASK, MASK] : [previous, next];
  }
  return changes;
}

const FIELD_WORDS: Record<string, string> = {
  phoneE164: 'phone',
  dateOfBirth: 'date of birth',
  linkedinUrl: 'LinkedIn',
  customFields: 'custom fields',
  subSourceId: 'sub-source',
  sourceId: 'source',
  organizationId: 'organization',
  contactId: 'contact',
  partnerId: 'partner',
};

/** A changed field's name as a person would say it: "companyWebsite" → "company website". */
export function fieldWords(key: string): string {
  return FIELD_WORDS[key] ?? key.replace(/([A-Z])/g, ' $1').toLowerCase();
}
