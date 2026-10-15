import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import {
  customFieldSchema,
  publishWebFormSchema,
  webFormSchema,
} from '@/modules/crm-config/schemas';
import { publishWebForm, saveCustomField, saveWebForm } from '@/modules/crm-config/service';
import { getWebForm, getWebForms } from '@/modules/crm-config/queries';
import { loadLeadConfig } from '@/modules/leads/config';
import { DEFAULT_FORM_FIELDS, formFieldsSchema, type FormField } from '@/modules/leads/form-fields';
import { getPublicWebForm, submitWebForm } from '@/modules/leads/public';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

/*
 * docs/leads.md §3.1: the business's admin builds each website form: its questions, their order
 * and wording, which are required, and questions of their own. A form is a draft until published.
 * A submission makes a New lead with the form's source and sub-source, or adds the enquiry to the
 * person already on file, and every answer lands on the contact. It starts from the form's key.
 */

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let tenantId: string;
let otherTenant: string;
const users: string[] = [];
const otherUsers: string[] = [];
let admin: TenantContext;
let member: TenantContext;
let outsider: TenantContext;
let formId: string;
let formKey: string;
let sourceId: string;
let subSourceId: string;
let visaKey: string;
let intakesKey: string;
let callKey: string;

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  // Some services refuse before they start, so the call is wrapped to catch either way.
  const error = await Promise.resolve()
    .then(run)
    .then(
      () => null,
      (caught: unknown) => caught,
    );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

const field = (target: string, label: string, required = false): FormField => ({
  id: target.replace(/\W/g, '-'),
  target,
  label,
  required,
  help: null,
});

const sender = () => `203.0.113.${Math.floor(Math.random() * 250)}`;
const submit = (input: Record<string, unknown>, from = sender()) =>
  submitWebForm(formKey, input, from);

const contactsByEmail = async (email: string) =>
  (await adminDb().execute(sql`
    select c.id, c.source_id, c.sub_source_id, c.lead_type, c.owner_user_id, c.utm, c.region,
           c.campaign_name, c.marketing_consent, c.company_name, c.custom_fields, c.phone,
           s.kind as status_kind
    from contacts c left join lead_statuses s on s.id = c.lead_status_id
    where c.tenant_id = ${tenantId} and c.email_normalized = ${email.toLowerCase()}`)) as unknown as Record<
    string,
    unknown
  >[];

const ownQuestion = async (label: string, fieldType: string, choices: string[] = []) =>
  (
    await saveCustomField(
      admin,
      customFieldSchema.parse({ entityType: 'contact', label, fieldType, choices }),
    )
  ).key;

beforeAll(async () => {
  const workspace = await createWorkspace(`Form Co ${stamp}`, mail('form-admin'));
  tenantId = workspace.tenantId;
  users.push(workspace.ownerId);
  const other = await createWorkspace(`Form Other ${stamp}`, mail('form-other'));
  otherTenant = other.tenantId;
  otherUsers.push(other.ownerId);
  const memberId = await addMember(tenantId, mail('form-member'), 'Mo Member', 'member');
  users.push(memberId);
  admin = await contextFor(workspace.ownerId, tenantId);
  member = await contextFor(memberId, tenantId);
  outsider = await contextFor(other.ownerId, otherTenant);

  const config = await withRls(admin, (tx) => loadLeadConfig(tx, admin));
  const source = config.sources.find((candidate) => candidate.subSources.length > 0)!;
  sourceId = source.id;
  subSourceId = source.subSources[0]!.id;

  visaKey = await ownQuestion(`Visa ${stamp}`, 'select', ['Student visa', 'Skilled visa']);
  intakesKey = await ownQuestion(`Intakes ${stamp}`, 'multi_select', ['February', 'July']);
  callKey = await ownQuestion(`Call me ${stamp}`, 'boolean');

  const { id } = await saveWebForm(
    admin,
    webFormSchema.parse({
      name: 'Free consultation',
      sourceId,
      subSourceId,
      leadType: 'b2c',
      heading: 'Book a free consultation',
      intro: 'A counsellor will call you within a day.',
      submitLabel: 'Book my call',
      thankYouMessage: 'We will call you within a day.',
      fields: [
        field('firstName', 'Your first name', true),
        field('lastName', 'Family name'),
        field('email', 'Email', true),
        field('phone', 'Mobile'),
        field('region', 'State'),
        field(`custom.${visaKey}`, 'Which visa are you interested in?', true),
        field(`custom.${intakesKey}`, 'Which intakes suit you?'),
        field(`custom.${callKey}`, 'I agree to a phone call', true),
        field('message', 'Anything else?'),
        field('consent', 'Send me news and offers'),
      ],
    }),
  );
  formId = id;
  const [row] = (await adminDb().execute(
    sql`select public_key from web_forms where id = ${id}`,
  )) as unknown as { public_key: string }[];
  formKey = row!.public_key;
});

afterAll(async () => {
  await destroyWorkspace(tenantId, users);
  await destroyWorkspace(otherTenant, otherUsers);
});

const complete = (email: string, extra: Record<string, unknown> = {}) => ({
  firstName: 'Vic',
  lastName: 'Visitor',
  email,
  [`custom.${visaKey}`]: 'student_visa',
  [`custom.${callKey}`]: 'on',
  ...extra,
});

describe('building a website form', () => {
  it('keeps a new form as a draft that nobody outside can open', async () => {
    const draft = await getWebForm(admin, formId);
    expect(draft).toMatchObject({ isActive: false, heading: 'Book a free consultation' });
    expect(draft!.fields.map((item) => item.target)).toContain(`custom.${visaKey}`);
    expect(await getPublicWebForm(formKey)).toBeNull();
    await expectCode(() => submit(complete(mail('early'))), 'NOT_FOUND');
  });

  it('needs a required first name and a required email or phone, each field once', () => {
    const without = (target: string) =>
      DEFAULT_FORM_FIELDS.filter((item) => item.target !== target);
    expect(formFieldsSchema.safeParse(DEFAULT_FORM_FIELDS).success).toBe(true);
    expect(formFieldsSchema.safeParse(without('firstName')).success).toBe(false);
    expect(
      formFieldsSchema.safeParse(
        DEFAULT_FORM_FIELDS.map((item) =>
          item.target === 'email' ? { ...item, required: false } : item,
        ),
      ).success,
    ).toBe(false);
    // A phone-only form is fine when the phone is required.
    expect(
      formFieldsSchema.safeParse([field('firstName', 'Name', true), field('phone', 'Phone', true)])
        .success,
    ).toBe(true);
    expect(
      formFieldsSchema.safeParse([...DEFAULT_FORM_FIELDS, field('email', 'Email again')]).success,
    ).toBe(false);
    expect(
      formFieldsSchema.safeParse([...DEFAULT_FORM_FIELDS, field('passportNumber', 'Passport')])
        .success,
    ).toBe(false);
  });

  it('refuses a question that is not one of the business’s own active contact fields', async () => {
    const base = {
      name: 'Bad form',
      sourceId,
      leadType: 'b2c',
      fields: [...DEFAULT_FORM_FIELDS, field('custom.no_such_field', 'Mystery')],
    };
    await expectCode(() => saveWebForm(admin, webFormSchema.parse(base)), 'VALIDATION');
    // Another business's field is not this business's, even with the same key.
    const theirs = await saveCustomField(
      outsider,
      customFieldSchema.parse({
        entityType: 'contact',
        label: `Theirs ${stamp}`,
        fieldType: 'text',
      }),
    );
    await expectCode(
      () =>
        saveWebForm(
          admin,
          webFormSchema.parse({
            ...base,
            fields: [...DEFAULT_FORM_FIELDS, field(`custom.${theirs.key}`, 'Theirs')],
          }),
        ),
      'VALIDATION',
    );
  });

  it('is only for people who manage settings, and only in their own business', async () => {
    const input = webFormSchema.parse({
      name: 'Sneaky',
      sourceId,
      leadType: 'b2c',
      fields: DEFAULT_FORM_FIELDS,
    });
    await expectCode(() => saveWebForm(member, input), 'FORBIDDEN');
    await expectCode(
      () => publishWebForm(member, publishWebFormSchema.parse({ id: formId, publish: true })),
      'FORBIDDEN',
    );
    await expectCode(
      () => publishWebForm(outsider, publishWebFormSchema.parse({ id: formId, publish: true })),
      'NOT_FOUND',
    );
    expect(await getWebForm(outsider, formId)).toBeNull();
    expect((await getWebForms(outsider)).map((row) => row.id)).not.toContain(formId);
    await expectCode(() => saveWebForm(outsider, { ...input, id: formId }), 'VALIDATION');
  });

  it('publishes the form as built, and audits it', async () => {
    await publishWebForm(admin, publishWebFormSchema.parse({ id: formId, publish: true }));
    const form = await getPublicWebForm(formKey);
    expect(form).toMatchObject({
      heading: 'Book a free consultation',
      intro: 'A counsellor will call you within a day.',
      submitLabel: 'Book my call',
    });
    expect(form!.fields.map((item) => item.label)).toEqual([
      'Your first name',
      'Family name',
      'Email',
      'Mobile',
      'State',
      'Which visa are you interested in?',
      'Which intakes suit you?',
      'I agree to a phone call',
      'Anything else?',
      'Send me news and offers',
    ]);
    const visa = form!.fields.find((item) => item.target === `custom.${visaKey}`)!;
    expect(visa).toMatchObject({ kind: 'select', required: true });
    expect(visa.choices.map((choice) => choice.label)).toEqual(['Student visa', 'Skilled visa']);
    expect((await getWebForms(admin)).find((row) => row.id === formId)).toMatchObject({
      isActive: true,
      fieldCount: 10,
    });
    const audits = (await adminDb().execute(sql`
      select count(*)::int as total from audit_logs
      where tenant_id = ${tenantId} and entity_type = 'web_form' and entity_id = ${formId}`)) as unknown as {
      total: number;
    }[];
    expect(audits[0]!.total).toBeGreaterThanOrEqual(2);
  });
});

describe('a published website form', () => {
  it('makes a New lead with every answer, the form’s source and the campaign tags', async () => {
    const email = mail('visitor');
    const result = await submit(
      complete(email, {
        phone: '0400 000 000',
        region: 'Victoria',
        [`custom.${intakesKey}`]: ['february', 'july'],
        message: 'Can I bring my family?',
        consent: true,
        companyName: 'Not asked for',
        utm_source: 'google',
        utm_campaign: 'spring-intake',
      }),
    );
    expect(result.thankYouMessage).toBe('We will call you within a day.');
    const [lead] = await contactsByEmail(email);
    expect(lead).toMatchObject({
      source_id: sourceId,
      sub_source_id: subSourceId,
      lead_type: 'b2c',
      status_kind: 'new',
      region: 'Victoria',
      campaign_name: 'spring-intake',
      marketing_consent: true,
      // The form does not ask for a company, so a script's extra field is dropped.
      company_name: null,
    });
    expect(lead!.utm).toEqual({ utm_source: 'google', utm_campaign: 'spring-intake' });
    expect(lead!.custom_fields).toEqual({
      [visaKey]: 'student_visa',
      [intakesKey]: ['february', 'july'],
      [callKey]: true,
    });
    const [enquiry] = (await adminDb().execute(
      sql`select body from activities where contact_id = ${lead!.id as string} and type = 'enquiry'`,
    )) as unknown as { body: string }[];
    expect(enquiry!.body).toContain('Can I bring my family?');
    expect(enquiry!.body).toContain('Which visa are you interested in?: Student visa');
    expect(enquiry!.body).toContain('Which intakes suit you?: February, July');
    const events = (await adminDb().execute(
      sql`select status from lead_intake_events where contact_id = ${lead!.id as string}`,
    )) as unknown as { status: string }[];
    expect(events.map((event) => event.status)).toEqual(['created']);
  });

  it('checks the answers against the form the admin built', async () => {
    const missing = await expectCode(
      () => submit({ firstName: 'Ann', email: mail('missing') }),
      'VALIDATION',
    );
    expect(Object.keys(missing.fieldErrors ?? {}).sort()).toEqual(
      [`custom.${callKey}`, `custom.${visaKey}`].sort(),
    );
    expect(missing.fieldErrors?.[`custom.${visaKey}`]?.[0]).toBe(
      'Which visa are you interested in? is required',
    );
    const wrong = await expectCode(
      () =>
        submit(
          complete(mail('wrong'), { [`custom.${visaKey}`]: 'tourist_visa', email: 'not-an-email' }),
        ),
      'VALIDATION',
    );
    expect(Object.keys(wrong.fieldErrors ?? {}).sort()).toEqual(
      ['email', `custom.${visaKey}`].sort(),
    );
    expect(await contactsByEmail(mail('missing'))).toHaveLength(0);
  });

  it('adds a repeat enquiry to the person on file, filling only what was blank', async () => {
    const email = mail('repeat');
    await submit(complete(email, { region: '' }));
    await submit(
      complete(email.toUpperCase(), {
        firstName: 'Someone else',
        region: 'Queensland',
        [`custom.${visaKey}`]: 'skilled_visa',
        message: 'Me again',
      }),
    );
    const rows = await contactsByEmail(email);
    expect(rows).toHaveLength(1);
    // A blank is filled; an answer already on file is not overwritten by a form.
    expect(rows[0]).toMatchObject({ region: 'Queensland' });
    expect((rows[0]!.custom_fields as Record<string, unknown>)[visaKey]).toBe('student_visa');
    const enquiries = (await adminDb().execute(
      sql`select body from activities where contact_id = ${rows[0]!.id as string} and type = 'enquiry' order by occurred_at`,
    )) as unknown as { body: string | null }[];
    expect(enquiries).toHaveLength(2);
    expect(enquiries[1]!.body).toContain('Me again');
  });

  it('matches a phone-only form by phone number', async () => {
    const { id } = await saveWebForm(
      admin,
      webFormSchema.parse({
        name: 'Call back',
        sourceId,
        leadType: 'b2c',
        fields: [field('firstName', 'Name', true), field('phone', 'Phone', true)],
      }),
    );
    await publishWebForm(admin, publishWebFormSchema.parse({ id, publish: true }));
    const [row] = (await adminDb().execute(
      sql`select public_key from web_forms where id = ${id}`,
    )) as unknown as { public_key: string }[];
    const phone = `04${String(stamp).slice(-8)}`;
    await submitWebForm(row!.public_key, { firstName: 'Pat', phone }, sender());
    await submitWebForm(row!.public_key, { firstName: 'Pat', phone }, sender());
    const found = (await adminDb().execute(sql`
      select count(*)::int as total from contacts
      where tenant_id = ${tenantId} and phone = ${phone}`)) as unknown as { total: number }[];
    expect(found[0]!.total).toBe(1);
    await expectCode(
      () => submitWebForm(row!.public_key, { firstName: 'Pat', phone: 'call me' }, sender()),
      'VALIDATION',
    );
  });

  it('drops a question whose field was switched off, and refuses to publish with it', async () => {
    await adminDb().execute(sql`
      update custom_field_definitions set is_active = false
      where tenant_id = ${tenantId} and key = ${intakesKey}`);
    const form = await getPublicWebForm(formKey);
    expect(form!.fields.map((item) => item.target)).not.toContain(`custom.${intakesKey}`);
    await expectCode(
      () => publishWebForm(admin, publishWebFormSchema.parse({ id: formId, publish: true })),
      'VALIDATION',
    );
    await adminDb().execute(sql`
      update custom_field_definitions set is_active = true
      where tenant_id = ${tenantId} and key = ${intakesKey}`);
  });

  it('refuses a wrong key, a form taken offline, and a business without the CRM', async () => {
    await expectCode(
      () => submitWebForm('not-a-real-key-aaaaaaaa', complete(mail('x')), null),
      'NOT_FOUND',
    );
    await publishWebForm(admin, publishWebFormSchema.parse({ id: formId, publish: false }));
    expect(await getPublicWebForm(formKey)).toBeNull();
    await expectCode(() => submit(complete(mail('off'))), 'NOT_FOUND');
    await publishWebForm(admin, publishWebFormSchema.parse({ id: formId, publish: true }));

    await adminDb().execute(
      sql`update tenants set features = array_remove(features, 'crm') where id = ${tenantId}`,
    );
    await expectCode(() => submit(complete(mail('nocrm'))), 'NOT_FOUND');
    await adminDb().execute(
      sql`update tenants set features = array_append(features, 'crm') where id = ${tenantId}`,
    );
    expect(await getPublicWebForm(formKey)).not.toBeNull();
  });

  it('limits how often one sender can submit', async () => {
    const from = '198.51.100.7';
    for (let i = 0; i < 5; i += 1) {
      await submit(complete(mail(`spam${i}`)), from);
    }
    await expectCode(() => submit(complete(mail('spam9')), from), 'RATE_LIMITED');
  });
});
