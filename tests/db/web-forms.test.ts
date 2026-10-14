import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { webFormSchema } from '@/modules/crm-config/schemas';
import { saveWebForm } from '@/modules/crm-config/service';
import { loadLeadConfig } from '@/modules/leads/config';
import { getPublicWebForm, submitWebForm } from '@/modules/leads/public';
import { webFormSubmissionSchema } from '@/modules/leads/schemas';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

/*
 * docs/leads.md §3.1: a website form makes a New lead with the form's source and sub-source, or
 * adds the enquiry to the person already on file. It starts from the form's key alone.
 */

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let tenantId: string;
const users: string[] = [];
let admin: TenantContext;
let formKey: string;
let sourceId: string;
let subSourceId: string;

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

const submit = (
  input: Record<string, unknown>,
  sender = `203.0.113.${Math.floor(Math.random() * 250)}`,
) => submitWebForm(formKey, webFormSubmissionSchema.parse(input), sender);

const contactsByEmail = async (email: string) =>
  (await adminDb().execute(sql`
    select c.id, c.source_id, c.sub_source_id, c.lead_type, c.owner_user_id, c.utm,
           c.campaign_name, c.marketing_consent, c.company_name, s.kind as status_kind
    from contacts c left join lead_statuses s on s.id = c.lead_status_id
    where c.tenant_id = ${tenantId} and c.email_normalized = ${email.toLowerCase()}`)) as unknown as Record<
    string,
    unknown
  >[];

beforeAll(async () => {
  const workspace = await createWorkspace(`Form Co ${stamp}`, mail('form-admin'));
  tenantId = workspace.tenantId;
  users.push(workspace.ownerId);
  admin = await contextFor(workspace.ownerId, tenantId);
  const config = await withRls(admin, (tx) => loadLeadConfig(tx, admin));
  const source = config.sources.find((candidate) => candidate.subSources.length > 0)!;
  sourceId = source.id;
  subSourceId = source.subSources[0]!.id;
  const { id } = await saveWebForm(
    admin,
    webFormSchema.parse({
      name: 'Contact us',
      sourceId,
      subSourceId,
      leadType: 'b2c',
      thankYouMessage: 'We will call you within a day.',
      askCompany: false,
    }),
  );
  const [row] = (await adminDb().execute(
    sql`select public_key from web_forms where id = ${id}`,
  )) as unknown as { public_key: string }[];
  formKey = row!.public_key;
});

afterAll(async () => {
  await destroyWorkspace(tenantId, users);
});

describe('a website form', () => {
  it('makes a New lead with the form’s source, sub-source and campaign tags', async () => {
    const email = mail('visitor');
    const result = await submit({
      firstName: 'Vic',
      lastName: 'Visitor',
      email,
      message: 'Do you deliver?',
      consent: true,
      companyName: 'Not asked for',
      utm_source: 'google',
      utm_campaign: 'spring-sale',
    });
    expect(result.thankYouMessage).toBe('We will call you within a day.');
    const [lead] = await contactsByEmail(email);
    expect(lead).toMatchObject({
      source_id: sourceId,
      sub_source_id: subSourceId,
      lead_type: 'b2c',
      status_kind: 'new',
      campaign_name: 'spring-sale',
      marketing_consent: true,
      // The form does not ask for a company, so a script's extra field is dropped.
      company_name: null,
    });
    expect(lead!.utm).toEqual({ utm_source: 'google', utm_campaign: 'spring-sale' });
    const events = (await adminDb().execute(
      sql`select status from lead_intake_events where contact_id = ${lead!.id as string}`,
    )) as unknown as { status: string }[];
    expect(events.map((event) => event.status)).toEqual(['created']);
  });

  it('adds a repeat enquiry to the person on file instead of a duplicate', async () => {
    const email = mail('repeat');
    await submit({ firstName: 'Rae', email });
    await submit({ firstName: 'Rae', email: email.toUpperCase(), message: 'Me again' });
    const rows = await contactsByEmail(email);
    expect(rows).toHaveLength(1);
    const enquiries = (await adminDb().execute(
      sql`select body from activities where contact_id = ${rows[0]!.id as string} and type = 'enquiry' order by occurred_at`,
    )) as unknown as { body: string | null }[];
    expect(enquiries.map((row) => row.body)).toEqual([null, 'Me again']);
  });

  it('refuses a wrong key, a switched-off form, and a business without the CRM', async () => {
    await expectCode(
      () =>
        submitWebForm(
          'not-a-real-key-aaaaaaaa',
          webFormSubmissionSchema.parse({ firstName: 'X', email: mail('x') }),
          null,
        ),
      'NOT_FOUND',
    );
    await adminDb().execute(
      sql`update web_forms set is_active = false where public_key = ${formKey}`,
    );
    expect(await getPublicWebForm(formKey)).toBeNull();
    await expectCode(() => submit({ firstName: 'Off', email: mail('off') }), 'NOT_FOUND');
    await adminDb().execute(
      sql`update web_forms set is_active = true where public_key = ${formKey}`,
    );

    await adminDb().execute(
      sql`update tenants set features = array_remove(features, 'crm') where id = ${tenantId}`,
    );
    await expectCode(() => submit({ firstName: 'NoCrm', email: mail('nocrm') }), 'NOT_FOUND');
    await adminDb().execute(
      sql`update tenants set features = array_append(features, 'crm') where id = ${tenantId}`,
    );
    expect(await getPublicWebForm(formKey)).not.toBeNull();
  });

  it('limits how often one sender can submit', async () => {
    const sender = '198.51.100.7';
    for (let i = 0; i < 5; i += 1) {
      await submit({ firstName: 'Spam', email: mail(`spam${i}`) }, sender);
    }
    await expectCode(
      () => submit({ firstName: 'Spam', email: mail('spam9') }, sender),
      'RATE_LIMITED',
    );
  });

  it('needs a name and a valid email', () => {
    expect(webFormSubmissionSchema.safeParse({ firstName: '', email: mail('a') }).success).toBe(
      false,
    );
    expect(webFormSubmissionSchema.safeParse({ firstName: 'A', email: 'nope' }).success).toBe(
      false,
    );
  });
});
