import { z } from 'zod';

import type { CustomFieldType } from '@/modules/custom-fields/validation';

/*
 * The fields a website form can ask (docs/leads.md §3.1). Each one lands somewhere in the CRM:
 * a contact field, the enquiry's message, the marketing consent, or one of the business's own
 * contact fields (`custom.<key>`). Nothing a form asks is kept only on the form, so every answer
 * shows on the lead and can be searched, routed and reported on.
 */

export type FormFieldKind =
  | 'text'
  | 'textarea'
  | 'email'
  | 'phone'
  | 'url'
  | 'number'
  | 'date'
  | 'checkbox'
  | 'select'
  | 'multi_select';

export const STANDARD_FORM_FIELDS = [
  { target: 'firstName', label: 'First name', kind: 'text', group: 'Contact details', max: 80 },
  { target: 'lastName', label: 'Last name', kind: 'text', group: 'Contact details', max: 80 },
  { target: 'email', label: 'Email', kind: 'email', group: 'Contact details', max: 200 },
  { target: 'phone', label: 'Phone', kind: 'phone', group: 'Contact details', max: 40 },
  { target: 'city', label: 'City / suburb', kind: 'text', group: 'Contact details', max: 80 },
  { target: 'region', label: 'State / region', kind: 'text', group: 'Contact details', max: 80 },
  {
    target: 'language',
    label: 'Preferred language',
    kind: 'text',
    group: 'Contact details',
    max: 40,
  },
  { target: 'companyName', label: 'Company', kind: 'text', group: 'Company', max: 160 },
  { target: 'jobTitle', label: 'Job title', kind: 'text', group: 'Company', max: 120 },
  { target: 'companyWebsite', label: 'Company website', kind: 'url', group: 'Company', max: 200 },
  { target: 'companySize', label: 'Company size', kind: 'text', group: 'Company', max: 40 },
  { target: 'industry', label: 'Industry', kind: 'text', group: 'Company', max: 80 },
  {
    target: 'interest',
    label: 'What are you interested in?',
    kind: 'text',
    group: 'Their enquiry',
    max: 160,
  },
  {
    target: 'message',
    label: 'How can we help?',
    kind: 'textarea',
    group: 'Their enquiry',
    max: 4000,
  },
  {
    target: 'consent',
    label: 'Send me news and offers by email. I can unsubscribe at any time.',
    kind: 'checkbox',
    group: 'Their enquiry',
    max: 0,
  },
] as const satisfies readonly {
  target: string;
  label: string;
  kind: FormFieldKind;
  group: string;
  max: number;
}[];

export type StandardTarget = (typeof STANDARD_FORM_FIELDS)[number]['target'];
export const standardField = (target: string) =>
  STANDARD_FORM_FIELDS.find((field) => field.target === target);

export const CUSTOM_KIND: Record<CustomFieldType, FormFieldKind> = {
  text: 'text',
  textarea: 'textarea',
  number: 'number',
  date: 'date',
  boolean: 'checkbox',
  select: 'select',
  multi_select: 'multi_select',
  email: 'email',
  phone: 'phone',
  url: 'url',
};

const TARGET =
  /^(firstName|lastName|email|phone|city|region|language|companyName|jobTitle|companyWebsite|companySize|industry|interest|message|consent|custom\.[a-z][a-z0-9_]{0,39})$/;

export const formFieldSchema = z.object({
  id: z.string().trim().min(1).max(40),
  target: z.string().regex(TARGET, 'Unknown field'),
  label: z.string().trim().min(1, 'Give the field a label').max(200),
  required: z.boolean().default(false),
  help: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((value) => value || null),
});

export type FormField = z.output<typeof formFieldSchema>;

/**
 * A form must be able to make a contact: a first name (required) and a way to reach the person,
 * an email or a phone, at least one of them required. Each target appears once.
 */
export const formFieldsSchema = z
  .array(formFieldSchema)
  .min(1)
  .max(30, 'A form can have up to 30 fields')
  .superRefine((fields, ctx) => {
    const targets = fields.map((field) => field.target);
    if (new Set(targets).size !== targets.length) {
      ctx.addIssue({ code: 'custom', message: 'Each field can be on the form only once.' });
    }
    const first = fields.find((field) => field.target === 'firstName');
    if (!first || !first.required) {
      ctx.addIssue({ code: 'custom', message: 'The form needs a required first name.' });
    }
    const reach = fields.filter((field) => field.target === 'email' || field.target === 'phone');
    if (!reach.some((field) => field.required)) {
      ctx.addIssue({
        code: 'custom',
        message: 'The form needs a required email or phone, so the team can reply.',
      });
    }
  });

/** What a new form starts with; the admin changes it from there. */
export const DEFAULT_FORM_FIELDS: FormField[] = [
  { id: 'first-name', target: 'firstName', label: 'First name', required: true, help: null },
  { id: 'last-name', target: 'lastName', label: 'Last name', required: false, help: null },
  { id: 'email', target: 'email', label: 'Email', required: true, help: null },
  { id: 'phone', target: 'phone', label: 'Phone', required: false, help: null },
  { id: 'message', target: 'message', label: 'How can we help?', required: false, help: null },
  {
    id: 'consent',
    target: 'consent',
    label: 'Send me news and offers by email. I can unsubscribe at any time.',
    required: false,
    help: null,
  },
];

/** A field as the public form shows it: the stored field plus what it needs to render. */
export type RenderedField = FormField & {
  kind: FormFieldKind;
  max: number;
  choices: { value: string; label: string }[];
};

/** Reads a stored field list, dropping anything malformed rather than failing the page. */
export function readFormFields(value: unknown): FormField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = formFieldSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * The form's fields ready to show: standard ones with their kind, the business's own with their
 * type and choices. A field whose own field was switched off since is left out.
 */
export function renderFields(
  fields: FormField[],
  custom: {
    key: string;
    fieldType: CustomFieldType;
    choices: { value: string; label: string; retired?: boolean }[];
    isActive: boolean;
  }[],
): RenderedField[] {
  return fields.flatMap((field): RenderedField[] => {
    if (field.target.startsWith('custom.')) {
      const definition = custom.find((item) => `custom.${item.key}` === field.target);
      if (!definition || !definition.isActive) return [];
      return [
        {
          ...field,
          kind: CUSTOM_KIND[definition.fieldType],
          max: definition.fieldType === 'textarea' ? 5000 : 200,
          // A website form offers only the options still on the list.
          choices: definition.choices.filter((choice) => !choice.retired),
        },
      ];
    }
    const standard = standardField(field.target);
    return standard ? [{ ...field, kind: standard.kind, max: standard.max, choices: [] }] : [];
  });
}
