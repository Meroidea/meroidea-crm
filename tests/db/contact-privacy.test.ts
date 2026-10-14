import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { logActivity } from '@/modules/activities/service';
import { logActivitySchema } from '@/modules/activities/schemas';
import { listPossibleDuplicates, getContact } from '@/modules/contacts/queries';
import { createContactSchema, updateContactSchema } from '@/modules/contacts/schemas';
import { anonymizeContact, mergeContacts } from '@/modules/contacts/privacy';
import { createContact, updateContact } from '@/modules/contacts/service';
import { createOpportunitySchema } from '@/modules/opportunities/schemas';
import { createOpportunity } from '@/modules/opportunities/service';
import { linkContacts } from '@/modules/leads/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

/*
 * docs/leads.md §3.4 and §6.5: two records of one person can be merged, and a person can be erased
 * on request. Both are admin-level, scoped, and stay inside one business.
 */

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let tenantId: string;
let otherTenant: string;
const users: string[] = [];
const otherUsers: string[] = [];
let admin: TenantContext;
let staff: TenantContext;
let outsider: TenantContext;

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

const person = (ctx: TenantContext, fields: Record<string, unknown>) =>
  createContact(ctx, createContactSchema.parse({ confirmDuplicate: true, ...fields }));

const row = async (id: string) =>
  (
    (await adminDb().execute(sql`select * from contacts where id = ${id}`)) as unknown as Record<
      string,
      unknown
    >[]
  )[0]!;

beforeAll(async () => {
  const one = await createWorkspace(`Privacy Co ${stamp}`, mail('priv-admin'));
  tenantId = one.tenantId;
  users.push(one.ownerId);
  const two = await createWorkspace(`Privacy Other ${stamp}`, mail('priv-other'));
  otherTenant = two.tenantId;
  otherUsers.push(two.ownerId);
  const staffId = await addMember(tenantId, mail('priv-staff'), 'Sky Staff', 'member');
  users.push(staffId);
  admin = await contextFor(one.ownerId, tenantId);
  staff = await contextFor(staffId, tenantId);
  outsider = await contextFor(two.ownerId, otherTenant);
});

afterAll(async () => {
  await destroyWorkspace(tenantId, users);
  await destroyWorkspace(otherTenant, otherUsers);
});

describe('merging duplicates', () => {
  it('fills the kept record’s gaps and moves everything across', async () => {
    const keep = await person(admin, {
      firstName: 'Mia',
      lastName: 'Merge',
      email: mail('mia'),
      jobTitle: 'Director',
    });
    const drop = await person(admin, {
      firstName: 'Mia',
      lastName: 'M.',
      email: mail('mia'),
      phone: '0400 123 456',
      jobTitle: 'Intern',
      doNotCall: true,
    });
    const sibling = await person(admin, { firstName: 'Sib', email: mail('sib') });
    await logActivity(
      admin,
      logActivitySchema.parse({ type: 'note', body: 'Met at the expo', contactId: drop.id }),
    );
    const opportunity = await createOpportunity(
      admin,
      createOpportunitySchema.parse({ name: 'Mia deal', contactId: drop.id }),
    );
    await linkContacts(admin, {
      contactId: drop.id,
      relatedContactId: keep.id,
      relationship: 'Spouse',
    });
    await linkContacts(admin, {
      contactId: drop.id,
      relatedContactId: sibling.id,
      relationship: 'Sibling',
    });

    const duplicates = await listPossibleDuplicates(admin, await getContact(admin, keep.id));
    expect(duplicates.map((item) => item.id)).toContain(drop.id);

    await mergeContacts(admin, { keepId: keep.id, dropId: drop.id });

    const kept = await row(keep.id);
    expect(kept.job_title).toBe('Director');
    expect(kept.phone).toBe('0400 123 456');
    expect(kept.do_not_call).toBe(true);
    expect((await row(drop.id)).deleted_at).not.toBeNull();

    const moved = (await adminDb().execute(sql`
      select (select count(*)::int from activities where contact_id = ${keep.id} and type = 'note') as notes,
             (select contact_id from opportunities where id = ${opportunity.id}) as opportunity_contact,
             (select count(*)::int from contact_links where contact_id = ${keep.id} and related_contact_id = ${sibling.id}) as sibling_links,
             (select count(*)::int from contact_links where contact_id = ${keep.id} and related_contact_id = ${keep.id}) as self_links,
             (select count(*)::int from contact_links where ${drop.id} in (contact_id, related_contact_id)) as left_behind
    `)) as unknown as Record<string, unknown>[];
    expect(moved[0]).toEqual({
      notes: 1,
      opportunity_contact: keep.id,
      sibling_links: 1,
      self_links: 0,
      left_behind: 0,
    });
    // The duplicate is gone from the list of possible duplicates.
    const after = await listPossibleDuplicates(admin, await getContact(admin, keep.id));
    expect(after.map((item) => item.id)).not.toContain(drop.id);
  });

  it('is refused without the merge permission, outside scope, and across businesses', async () => {
    const a = await person(admin, { firstName: 'Ann', email: mail('ann') });
    const b = await person(admin, { firstName: 'Ann', email: mail('ann') });
    await expectCode(() => mergeContacts(staff, { keepId: a.id, dropId: b.id }), 'FORBIDDEN');
    await expectCode(() => mergeContacts(outsider, { keepId: a.id, dropId: b.id }), 'NOT_FOUND');
    const mine = await person(outsider, { firstName: 'Ann', email: mail('ann') });
    await expectCode(() => mergeContacts(admin, { keepId: a.id, dropId: mine.id }), 'NOT_FOUND');
    await expectCode(() => mergeContacts(admin, { keepId: a.id, dropId: a.id }), 'VALIDATION');
  });

  it('cannot be run straight from the database by someone without the permission', async () => {
    const a = await person(staff, { firstName: 'Dee', email: mail('dee') });
    const b = await person(staff, { firstName: 'Dee', email: mail('dee') });
    const error = await withRls(staff, (tx) =>
      tx.execute(sql`select app.merge_contact_references(${a.id}::uuid, ${b.id}::uuid)`),
    ).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).not.toBeNull();
    expect((await row(b.id)).deleted_at).toBeNull();
  });
});

describe('erasing a person on request', () => {
  it('clears their details, notes, submissions and change history values', async () => {
    const { id } = await person(admin, {
      firstName: 'Eve',
      lastName: 'Erase',
      email: mail('eve'),
      phone: '0400 555 666',
      city: 'Sydney',
      marketingConsent: true,
    });
    await logActivity(
      admin,
      logActivitySchema.parse({ type: 'note', body: 'Eve’s partner is called Sam', contactId: id }),
    );
    await updateContact(
      admin,
      updateContactSchema.parse({ id, firstName: 'Eve', lastName: 'Erase', city: 'Melbourne' }),
    );
    await adminDb().execute(sql`
      insert into lead_intake_events (tenant_id, channel, payload, status, contact_id)
      values (${tenantId}, 'web_form', ${JSON.stringify({ email: mail('eve') })}::jsonb, 'matched', ${id})`);

    await anonymizeContact(admin, id);

    const erased = await row(id);
    expect(erased).toMatchObject({
      first_name: 'Erased',
      last_name: null,
      email: null,
      phone: null,
      city: null,
      marketing_consent: false,
      do_not_email: true,
      status: 'do_not_contact',
    });
    expect(erased.anonymized_at).not.toBeNull();
    const traces = (await adminDb().execute(sql`
      select (select string_agg(coalesce(body, ''), '') from activities where contact_id = ${id}) as bodies,
             (select payload from lead_intake_events where contact_id = ${id}) as payload,
             (select changes from audit_logs where entity_id = ${id} and changes ? 'city') as changes
    `)) as unknown as { bodies: string; payload: unknown; changes: unknown }[];
    expect(traces[0]!.bodies).toBe('');
    expect(traces[0]!.payload).toEqual({ erased: true });
    expect(traces[0]!.changes).toMatchObject({ city: ['•••', '•••'] });
    expect(JSON.stringify(traces[0]!.changes)).not.toMatch(/Melbourne|Sydney|0400/);

    await expectCode(() => anonymizeContact(admin, id), 'CONFLICT');
  });

  it('is refused without the permission, and across businesses', async () => {
    const { id } = await person(staff, { firstName: 'Fay', email: mail('fay') });
    await expectCode(() => anonymizeContact(staff, id), 'FORBIDDEN');
    await expectCode(() => anonymizeContact(outsider, id), 'NOT_FOUND');
    expect((await row(id)).first_name).toBe('Fay');
  });
});
