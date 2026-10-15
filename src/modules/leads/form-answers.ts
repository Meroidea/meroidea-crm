import { z } from 'zod';

import { cleanCustomFields, type CustomFieldDefinition } from '@/modules/custom-fields/validation';

import type { RenderedField, StandardTarget } from './form-fields';

/** Contact fields a form can fill, other than the enquiry's message and the consent. */
export type ContactAnswers = Partial<
  Record<Exclude<StandardTarget, 'message' | 'consent'>, string>
>;

export type FormAnswers = {
  contact: ContactAnswers;
  message: string | null;
  consent: boolean;
  custom: Record<string, unknown>;
  /** "Label: answer" for everything asked beyond name and contact details, for the timeline. */
  summary: string[];
};

const asText = (value: unknown) =>
  typeof value === 'string' ? value.trim() : Array.isArray(value) ? '' : '';

const asChecked = (value: unknown) =>
  value === true || value === 'true' || value === 'on' || value === 'yes';

const withScheme = (value: string) => (/^https?:\/\//i.test(value) ? value : `https://${value}`);

/**
 * Checks a submission against the form the admin built (docs/leads.md §3.1). Only the form's own
 * fields are read; anything else in the body is ignored. Problems come back keyed by field, in
 * words a visitor understands.
 */
export function readAnswers(
  fields: RenderedField[],
  definitions: CustomFieldDefinition[],
  body: Record<string, unknown>,
): { answers: FormAnswers; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};
  const answers: FormAnswers = {
    contact: {},
    message: null,
    consent: false,
    custom: {},
    summary: [],
  };
  const fail = (target: string, message: string) => {
    errors[target] = [message];
  };

  for (const field of fields) {
    if (field.target.startsWith('custom.')) continue;
    const raw = body[field.target];
    if (field.target === 'consent') {
      answers.consent = asChecked(raw);
      if (field.required && !answers.consent)
        fail(field.target, 'Please tick this box to continue');
      continue;
    }
    const text = asText(raw);
    if (!text) {
      if (field.required) fail(field.target, `${field.label} is required`);
      continue;
    }
    if (text.length > field.max) {
      fail(field.target, `Use at most ${field.max} characters`);
      continue;
    }
    let value = text;
    if (field.kind === 'email') {
      if (!z.email().safeParse(text).success) {
        fail(field.target, 'Enter a valid email address');
        continue;
      }
    } else if (field.kind === 'phone') {
      if ((text.match(/\d/g) ?? []).length < 6) {
        fail(field.target, 'Enter a valid phone number');
        continue;
      }
    } else if (field.kind === 'url') {
      value = withScheme(text);
      if (!z.url().safeParse(value).success) {
        fail(field.target, 'Enter a valid web address');
        continue;
      }
    }
    if (field.target === 'message') answers.message = value;
    else {
      answers.contact[field.target as keyof ContactAnswers] = value;
      if (!['firstName', 'lastName', 'email', 'phone'].includes(field.target)) {
        answers.summary.push(`${field.label}: ${value}`);
      }
    }
  }

  // The business's own fields: checked with the same rules as on the contact form, with the
  // form's own "required" in place of the field's.
  const onForm = fields.filter((field) => field.target.startsWith('custom.'));
  if (onForm.length > 0) {
    const used = onForm.flatMap((field) => {
      const definition = definitions.find((item) => `custom.${item.key}` === field.target);
      // Messages use the form's own wording for the question.
      return definition
        ? [{ ...definition, label: field.label, isActive: true, isRequired: field.required }]
        : [];
    });
    const submitted: Record<string, unknown> = {};
    for (const field of onForm) {
      const key = field.target.slice('custom.'.length);
      const raw = body[field.target];
      submitted[key] =
        field.kind === 'checkbox'
          ? asChecked(raw)
          : field.kind === 'multi_select'
            ? (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(
                (item) => typeof item === 'string',
              )
            : typeof raw === 'string'
              ? field.kind === 'url' && raw.trim()
                ? withScheme(raw.trim())
                : raw.trim()
              : '';
    }
    const cleaned = cleanCustomFields(used, submitted);
    for (const [path, messages] of Object.entries(cleaned.errors)) errors[path] = messages;
    // A required tick box on a form (say, agreeing to be called) has to be ticked.
    for (const field of onForm) {
      const key = field.target.slice('custom.'.length);
      if (field.kind === 'checkbox' && field.required && cleaned.values[key] !== true) {
        fail(field.target, 'Please tick this box to continue');
      }
    }
    answers.custom = cleaned.values;
    for (const field of onForm) {
      const value = cleaned.values[field.target.slice('custom.'.length)];
      if (value === undefined) continue;
      const shown = Array.isArray(value)
        ? value
            .map((item) => field.choices.find((choice) => choice.value === item)?.label ?? item)
            .join(', ')
        : typeof value === 'boolean'
          ? value
            ? 'Yes'
            : 'No'
          : (field.choices.find((choice) => choice.value === value)?.label ?? String(value));
      answers.summary.push(`${field.label}: ${shown}`);
    }
  }

  if (!answers.contact.email && !answers.contact.phone && Object.keys(errors).length === 0) {
    const reach =
      fields.find((field) => field.target === 'email') ??
      fields.find((field) => field.target === 'phone');
    fail(reach?.target ?? 'email', 'Give an email or phone number so we can reply');
  }
  return { answers, errors };
}
