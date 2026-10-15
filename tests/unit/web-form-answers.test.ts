import { describe, expect, it } from 'vitest';

import type { CustomFieldDefinition } from '@/modules/custom-fields/validation';
import { readAnswers } from '@/modules/leads/form-answers';
import { renderFields, type FormField } from '@/modules/leads/form-fields';

/* docs/leads.md §3.1: a submission is read only through the fields the admin put on the form. */

const definitions: CustomFieldDefinition[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    key: 'study_level',
    label: 'Study level',
    description: null,
    fieldType: 'select',
    choices: [
      { value: 'bachelor', label: 'Bachelor' },
      { value: 'master', label: 'Master' },
    ],
    isRequired: false,
    isActive: true,
    showInList: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    key: 'agree_call',
    label: 'Agree to a call',
    description: null,
    fieldType: 'boolean',
    choices: [],
    isRequired: false,
    isActive: true,
    showInList: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    key: 'portfolio',
    label: 'Portfolio',
    description: null,
    fieldType: 'url',
    choices: [],
    isRequired: false,
    isActive: true,
    showInList: false,
  },
];

const field = (target: string, label: string, required = false): FormField => ({
  id: target,
  target,
  label,
  required,
  help: null,
});

const form = renderFields(
  [
    field('firstName', 'First name', true),
    field('phone', 'Mobile', true),
    field('companyWebsite', 'Website'),
    field('custom.study_level', 'What will you study?', true),
    field('custom.agree_call', 'Call me', true),
    field('custom.portfolio', 'Portfolio'),
    field('consent', 'News and offers'),
  ],
  definitions,
);

const read = (body: Record<string, unknown>) => readAnswers(form, definitions, body);

describe('reading a website form submission', () => {
  it('keeps the form’s answers and ignores anything the form did not ask', () => {
    const { answers, errors } = read({
      firstName: ' Ana ',
      phone: '0400 111 222',
      companyWebsite: 'example.com',
      'custom.study_level': 'master',
      'custom.agree_call': 'on',
      'custom.portfolio': 'example.com/ana',
      consent: 'on',
      email: 'not-asked@example.com',
      companyName: 'Not asked',
    });
    expect(errors).toEqual({});
    expect(answers.contact).toEqual({
      firstName: 'Ana',
      phone: '0400 111 222',
      companyWebsite: 'https://example.com',
    });
    expect(answers.custom).toEqual({
      study_level: 'master',
      agree_call: true,
      portfolio: 'https://example.com/ana',
    });
    expect(answers.consent).toBe(true);
    expect(answers.summary).toEqual([
      'Website: https://example.com',
      'What will you study?: Master',
      'Call me: Yes',
      'Portfolio: https://example.com/ana',
    ]);
  });

  it('reports each problem against its field, in the form’s own words', () => {
    const { errors } = read({ firstName: '', phone: 'ring me', 'custom.study_level': 'phd' });
    expect(errors).toEqual({
      firstName: ['First name is required'],
      phone: ['Enter a valid phone number'],
      'custom.study_level': ['Pick an option'],
      'custom.agree_call': ['Please tick this box to continue'],
    });
    expect(
      read({ firstName: 'Ana', phone: '0400111222', 'custom.agree_call': 'on' }).errors,
    ).toEqual({ 'custom.study_level': ['What will you study? is required'] });
  });

  it('leaves out a question whose field was switched off', () => {
    const rendered = renderFields(
      [field('firstName', 'First name', true), field('custom.study_level', 'Level')],
      definitions.map((item) => ({ ...item, isActive: false })),
    );
    expect(rendered.map((item) => item.target)).toEqual(['firstName']);
  });
});
