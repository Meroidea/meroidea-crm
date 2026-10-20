import { z } from 'zod';

/** The field kinds a business can add (docs/database.md §8, custom_field_definitions). */
export const CUSTOM_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'date',
  'boolean',
  'select',
  'multi_select',
  'email',
  'phone',
  'url',
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Short text',
  textarea: 'Long text',
  number: 'Number',
  date: 'Date',
  boolean: 'Checkbox',
  select: 'Picklist',
  multi_select: 'Picklist (several)',
  email: 'Email',
  phone: 'Phone',
  url: 'Web address',
};

export const CUSTOM_ENTITIES = ['contact', 'organization', 'opportunity'] as const;
export type CustomEntity = (typeof CUSTOM_ENTITIES)[number];

export type CustomFieldDefinition = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  fieldType: CustomFieldType;
  choices: FieldChoice[];
  isRequired: boolean;
  isActive: boolean;
  showInList: boolean;
};

/**
 * A picklist's options. A retired one was removed from the list but is kept, so records that
 * hold it still show and save it; it is no longer offered for new picks.
 */
export type FieldChoice = { value: string; label: string; retired?: boolean };

export function choicesOf(options: unknown): FieldChoice[] {
  const raw = (options as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((choice) => {
    const parsed = z
      .object({ value: z.string(), label: z.string(), retired: z.boolean().optional() })
      .safeParse(choice);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * The options after an edit of the labels, keeping each stored value stable: an option keeps
 * its value when its label is unchanged or was renamed in place, so records holding it stay
 * valid; only a new option gets a new value, never one already used. Options taken off the
 * list are kept as retired.
 */
export function reconcileChoices(labels: string[], existing: FieldChoice[]): FieldChoice[] {
  const norm = (label: string) => label.trim().toLowerCase();
  const wanted = labels.map(norm);
  const active = existing.filter((choice) => !choice.retired);
  const used = new Set<string>();
  const taken = new Set(existing.map((choice) => choice.value));
  const result: FieldChoice[] = labels.map((label, index) => {
    const sameLabel = existing.find(
      (choice) => norm(choice.label) === norm(label) && !used.has(choice.value),
    );
    // A rename: the option in the same place whose old label is gone, or else the only option
    // whose old label is gone. With several gone and moved around, it is a new option.
    const gone = (choice: FieldChoice) =>
      !used.has(choice.value) && !wanted.includes(norm(choice.label));
    const inPlace = active[index];
    const orphans = active.filter(gone);
    const renamed =
      inPlace && gone(inPlace) ? inPlace : orphans.length === 1 ? orphans[0] : undefined;
    const match = sameLabel ?? renamed;
    if (match) {
      used.add(match.value);
      return { value: match.value, label };
    }
    const base = keyFromLabel(label);
    let value = base;
    for (let i = 2; taken.has(value); i += 1) value = `${base.slice(0, 36)}_${i}`;
    taken.add(value);
    used.add(value);
    return { value, label };
  });
  for (const choice of existing) {
    if (!used.has(choice.value)) result.push({ ...choice, retired: true });
  }
  return result;
}

/** A field label becomes an immutable key: "Preferred intake" → "preferred_intake". */
export function keyFromLabel(label: string): string {
  const key = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return /^[a-z]/.test(key) ? key : `field_${key}`.slice(0, 40);
}

function valueSchema(field: CustomFieldDefinition): z.ZodType {
  const text = (max: number) => z.string().trim().max(max);
  switch (field.fieldType) {
    case 'text':
      return text(200);
    case 'textarea':
      return text(5000);
    case 'number':
      return z.union([z.number(), z.string().trim()]).transform((value, ctx) => {
        if (value === '') return '';
        const number = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(number)) {
          ctx.addIssue({ code: 'custom', message: 'Enter a number' });
          return z.NEVER;
        }
        return number;
      });
    case 'date':
      return z.union([z.literal(''), z.iso.date('Use a valid date')]);
    case 'boolean':
      return z
        .union([z.boolean(), z.literal('true'), z.literal('false'), z.literal('')])
        .transform((value) => value === true || value === 'true');
    case 'select': {
      const values = field.choices.map((choice) => choice.value);
      return z.string().refine((value) => value === '' || values.includes(value), 'Pick an option');
    }
    case 'multi_select': {
      const values = field.choices.map((choice) => choice.value);
      return z
        .union([z.array(z.string()), z.string()])
        .transform((value) => (Array.isArray(value) ? value : value ? [value] : []))
        .refine((list) => list.every((item) => values.includes(item)), 'Pick from the options');
    }
    case 'email':
      return z.union([z.literal(''), z.email('Enter a valid email address').max(200)]);
    case 'phone':
      return text(40);
    case 'url':
      return z.union([z.literal(''), z.url('Enter the full address, starting https://').max(300)]);
  }
}

const isEmpty = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

/**
 * Validates submitted custom values against the business's active fields and returns what to
 * store: known keys only, empty values dropped, values of switched-off fields kept as they were
 * (so switching a field off never erases data). Errors come back keyed `custom.<key>`.
 */
export function cleanCustomFields(
  definitions: CustomFieldDefinition[],
  submitted: Record<string, unknown>,
  existing: Record<string, unknown> = {},
): { values: Record<string, unknown>; errors: Record<string, string[]> } {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string[]> = {};

  for (const field of definitions) {
    if (!field.isActive) {
      if (existing[field.key] !== undefined) values[field.key] = existing[field.key];
      continue;
    }
    const raw = submitted[field.key];
    if (isEmpty(raw) || raw === false) {
      if (field.isRequired && field.fieldType !== 'boolean') {
        errors[`custom.${field.key}`] = [`${field.label} is required`];
      } else if (field.fieldType === 'boolean' && raw === false) {
        values[field.key] = false;
      }
      continue;
    }
    const parsed = valueSchema(field).safeParse(raw);
    if (!parsed.success) {
      errors[`custom.${field.key}`] = [parsed.error.issues[0]?.message ?? 'Invalid value'];
      continue;
    }
    if (!isEmpty(parsed.data)) values[field.key] = parsed.data;
    else if (field.isRequired) errors[`custom.${field.key}`] = [`${field.label} is required`];
  }
  return { values, errors };
}

/** How a stored value reads on a record page. */
export function displayCustomValue(field: CustomFieldDefinition, value: unknown): string {
  if (isEmpty(value)) return '—';
  if (field.fieldType === 'boolean') return value === true ? 'Yes' : 'No';
  if (field.fieldType === 'select') {
    return field.choices.find((choice) => choice.value === value)?.label ?? String(value);
  }
  if (field.fieldType === 'multi_select' && Array.isArray(value)) {
    return value
      .map((item) => field.choices.find((choice) => choice.value === item)?.label ?? String(item))
      .join(', ');
  }
  return String(value);
}
