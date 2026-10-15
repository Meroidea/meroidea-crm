import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { customFieldSchema } from '@/modules/crm-config/schemas';
import { saveCustomField } from '@/modules/crm-config/service';
import { createContactSchema } from '@/modules/contacts/schemas';
import { createContact } from '@/modules/contacts/service';
import { getImportBatch, listImportBatches } from '@/modules/imports/queries';
import { importChunkSchema, startImportSchema } from '@/modules/imports/schemas';
import { finishImport, importContactsChunk, startImport } from '@/modules/imports/service';
import { loadLeadConfig } from '@/modules/leads/config';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

/*
 * docs/leads.md §3.1: a spreadsheet upload is a batch with one source, sub-source and campaign;
 * duplicates are skipped, merged into the existing record or created anyway, and every row's
 * outcome is kept in the batch's report.
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
let eventsId: string;
let expoId: string;

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

const start = (ctx: TenantContext, overrides: Record<string, unknown> = {}) =>
  startImport(
    ctx,
    startImportSchema.parse({
      fileName: 'expo.xlsx',
      rowCount: 10,
      asLeads: true,
      leadType: 'b2b',
      sourceId: eventsId,
      subSourceId: expoId,
      campaignName: 'Expo 2026',
      ...overrides,
    }),
  );

const chunk = (ctx: TenantContext, batchId: string, rows: Record<string, string>[]) =>
  importContactsChunk(ctx, importChunkSchema.parse({ rows, firstRowNumber: 2, batchId }));

const contactRow = async (id: string) =>
  (
    (await adminDb().execute(sql`
      select c.owner_user_id, c.source_id, c.sub_source_id, c.campaign_name, c.import_batch_id,
             c.lead_type, c.phone, c.job_title, c.custom_fields, s.kind as status_kind
      from contacts c left join lead_statuses s on s.id = c.lead_status_id
      where c.id = ${id}`)) as unknown as Record<string, unknown>[]
  )[0]!;

beforeAll(async () => {
  const one = await createWorkspace(`Import Co ${stamp}`, mail('imp-admin'));
  tenantId = one.tenantId;
  users.push(one.ownerId);
  const two = await createWorkspace(`Other Import Co ${stamp}`, mail('imp-other'));
  otherTenant = two.tenantId;
  otherUsers.push(two.ownerId);
  // A manager imports, with team scope: records of people outside their team aren't theirs to edit.
  const memberId = await addMember(tenantId, mail('imp-member'), 'Morgan Manager', 'manager');
  users.push(memberId);
  admin = await contextFor(one.ownerId, tenantId);
  member = await contextFor(memberId, tenantId);
  outsider = await contextFor(two.ownerId, otherTenant);

  const config = await withRls(admin, (tx) => loadLeadConfig(tx, admin));
  const events = config.sources.find((source) => source.subSources.length > 0)!;
  eventsId = events.id;
  expoId = events.subSources[0]!.id;
});

afterAll(async () => {
  await destroyWorkspace(tenantId, users);
  await destroyWorkspace(otherTenant, otherUsers);
});

describe('starting an upload', () => {
  it('needs a source and sub-source when the rows are leads', async () => {
    await expectCode(() => start(admin, { sourceId: '', subSourceId: '' }), 'VALIDATION');
    await expectCode(() => start(admin, { subSourceId: '' }), 'VALIDATION');
    const plain = await start(admin, { asLeads: false, sourceId: '', subSourceId: '' });
    expect(plain.id).toBeTruthy();
  });

  it('keeps the queue for people who can assign to anyone', async () => {
    await expectCode(() => start(member, { assignment: 'queue' }), 'FORBIDDEN');
  });
});

describe('uploading leads', () => {
  it('creates New leads with the batch’s source, sub-source and campaign', async () => {
    const { id: batchId } = await start(admin);
    const result = await chunk(admin, batchId, [
      { fullName: 'Ana Lima', email: `ana-${stamp}@example.com`, jobTitle: 'Buyer' },
      { firstName: 'Ben', email: `ben-${stamp}@example.com`, phone: '0400 000 111' },
      { email: 'missing-name@example.com' },
    ]);
    expect(result).toMatchObject({ created: 2, merged: 0, skippedDuplicates: 0 });
    expect(result.invalid.map((row) => row.row)).toEqual([4]);

    const batch = await getImportBatch(admin, batchId);
    const created = batch!.rows.find((row) => row.outcome === 'created')!;
    const stored = await contactRow(created.contactId!);
    expect(stored).toMatchObject({
      source_id: eventsId,
      sub_source_id: expoId,
      campaign_name: 'Expo 2026',
      import_batch_id: batchId,
      lead_type: 'b2b',
      owner_user_id: admin.userId,
      status_kind: 'new',
    });
    expect(batch).toMatchObject({ createdCount: 2, errorCount: 1, asLeads: true });
    // Reasons name the column, never what was in it.
    const error = batch!.rows.find((row) => row.outcome === 'error')!;
    expect(error.reason).toContain('firstName');
    expect(error.reason).not.toContain('missing-name');
  });

  it('skips duplicates of the workspace and of earlier rows, across chunks', async () => {
    const { id: batchId } = await start(admin, { duplicates: 'skip' });
    await chunk(admin, batchId, [{ fullName: 'Cara One', email: `cara-${stamp}@example.com` }]);
    const second = await chunk(admin, batchId, [
      { fullName: 'Cara Again', email: `CARA-${stamp}@example.com` },
      { fullName: 'Ana Repeat', email: `ana-${stamp}@example.com` },
    ]);
    expect(second).toMatchObject({ created: 0, skippedDuplicates: 2 });
    const batch = await getImportBatch(admin, batchId);
    expect(batch!.rows.filter((row) => row.outcome === 'skipped')).toHaveLength(2);
  });

  it('merges into the existing record without overwriting what it holds', async () => {
    const existing = await createContact(
      admin,
      createContactSchema.parse({
        firstName: 'Dana',
        email: `dana-${stamp}@example.com`,
        jobTitle: 'Director',
      }),
    );
    const { id: batchId } = await start(admin, { duplicates: 'merge' });
    const result = await chunk(admin, batchId, [
      {
        fullName: 'Dana Changed',
        email: `dana-${stamp}@example.com`,
        jobTitle: 'Intern',
        phone: '0400 222 333',
      },
    ]);
    expect(result).toMatchObject({ created: 0, merged: 1 });
    const stored = await contactRow(existing.id);
    expect(stored.job_title).toBe('Director');
    expect(stored.phone).toBe('0400 222 333');
  });

  it('only merges into records the importer may edit', async () => {
    const theirs = await createContact(
      admin,
      createContactSchema.parse({ firstName: 'Eli', email: `eli-${stamp}@example.com` }),
    );
    const { id: batchId } = await start(member, { duplicates: 'merge' });
    const result = await chunk(member, batchId, [
      { fullName: 'Eli Other', email: `eli-${stamp}@example.com`, phone: '0400 999 888' },
    ]);
    expect(result).toMatchObject({ merged: 0, skippedDuplicates: 1 });
    expect((await contactRow(theirs.id)).phone).toBeNull();
  });

  it('creates, and flags, someone who only shares a name and company with an existing record', async () => {
    await createContact(
      admin,
      createContactSchema.parse({
        firstName: 'Lee',
        lastName: `Same ${stamp}`,
        companyName: `Acme ${stamp}`,
        email: mail('lee-one'),
      }),
    );
    for (const duplicates of ['skip', 'merge'] as const) {
      const { id: batchId } = await start(admin, { duplicates, asLeads: false });
      const result = await chunk(admin, batchId, [
        {
          fullName: `Lee Same ${stamp}`,
          companyName: `Acme ${stamp}`,
          email: mail(`lee-${duplicates}`),
        },
      ]);
      // A different email: a different person, so neither skipped nor merged into the first.
      expect(result).toMatchObject({ skippedDuplicates: 0, merged: 0 });
      const batch = await getImportBatch(admin, batchId);
      expect(batch!.rows[0]?.outcome).toBe('duplicate_created');
    }
  });

  it('spreads an upload across a least-loaded rule instead of giving it all to one person', async () => {
    const first = await addMember(tenantId, mail('imp-load-a'), 'Load A', 'member');
    const second = await addMember(tenantId, mail('imp-load-b'), 'Load B', 'member');
    users.push(first, second);
    await adminDb().execute(sql`
      insert into routing_rules (tenant_id, name, stage, method, user_ids, conditions)
      values (${tenantId}, 'Expo spread', 'intake', 'least_loaded',
        array[${first}, ${second}]::uuid[],
        ${JSON.stringify({ subSourceIds: [expoId] })}::jsonb)`);
    const { id: batchId } = await start(admin, { assignment: 'auto', duplicates: 'create' });
    await chunk(
      admin,
      batchId,
      [1, 2, 3, 4].map((n) => ({ fullName: `Spread ${n}`, email: mail(`spread-${n}`) })),
    );
    const owners = (await adminDb().execute(
      sql`select owner_user_id from contacts where import_batch_id = ${batchId}`,
    )) as unknown as { owner_user_id: string }[];
    const counts = owners.reduce<Record<string, number>>((all, row) => {
      all[row.owner_user_id] = (all[row.owner_user_id] ?? 0) + 1;
      return all;
    }, {});
    expect(counts).toEqual({ [first]: 2, [second]: 2 });
    await adminDb().execute(sql`delete from routing_rules where name = 'Expo spread'`);
  });

  it('creates duplicates anyway when asked, and says so in the report', async () => {
    const { id: batchId } = await start(admin, { duplicates: 'create' });
    const result = await chunk(admin, batchId, [
      { fullName: 'Ana Twin', email: `ana-${stamp}@example.com` },
    ]);
    expect(result).toMatchObject({ created: 0, duplicatesCreated: 1 });
    const batch = await getImportBatch(admin, batchId);
    expect(batch!.rows[0]!.outcome).toBe('duplicate_created');
    expect(batch!.duplicateCreatedCount).toBe(1);
  });

  it('reads the business’s own fields, by choice label as typed', async () => {
    const field = await saveCustomField(
      admin,
      customFieldSchema.parse({
        entityType: 'contact',
        label: 'Budget band',
        fieldType: 'select',
        choices: ['Under 10k', '10k and over'],
        isRequired: true,
      }),
    );
    const [definition] = (await adminDb().execute(
      sql`select key, options from custom_field_definitions where id = ${field.id}`,
    )) as unknown as { key: string; options: { choices: { value: string; label: string }[] } }[];
    const key = definition!.key;
    const large = definition!.options.choices.find((choice) => choice.label === '10k and over')!;
    const { id: batchId } = await start(admin);
    const result = await chunk(admin, batchId, [
      {
        fullName: 'Fay Field',
        email: `fay-${stamp}@example.com`,
        [`custom.${key}`]: '10K and over',
      },
      // A required field the file leaves blank is a gap to fill later, not a rejected row.
      { fullName: 'Gus Gap', email: `gus-${stamp}@example.com` },
      { fullName: 'Hal Bad', email: `hal-${stamp}@example.com`, [`custom.${key}`]: 'Huge' },
    ]);
    expect(result).toMatchObject({ created: 2 });
    expect(result.invalid).toHaveLength(1);
    const batch = await getImportBatch(admin, batchId);
    const fay = batch!.rows.find((row) => row.row === 2)!;
    expect((await contactRow(fay.contactId!)).custom_fields).toEqual({ [key]: large.value });
  });
});

describe('who sees an upload', () => {
  it('keeps a batch to the person who started it', async () => {
    const { id: batchId } = await start(admin);
    await expectCode(() => chunk(member, batchId, [{ fullName: 'Ivy' }]), 'NOT_FOUND');
    await expectCode(() => chunk(outsider, batchId, [{ fullName: 'Ivy' }]), 'NOT_FOUND');
    expect(await getImportBatch(member, batchId)).toBeNull();
    expect(await getImportBatch(outsider, batchId)).toBeNull();
    expect((await listImportBatches(admin)).some((batch) => batch.id === batchId)).toBe(true);
  });

  it('stops taking rows once finished, and tells each new owner once', async () => {
    const { id: batchId } = await start(admin, { assignment: 'me' });
    await adminDb().execute(
      sql`update import_batches set report = jsonb_set(report, '{assignment}', '"me"') where id = ${batchId}`,
    );
    await chunk(admin, batchId, [{ fullName: 'Jo Lead', email: `jo-${stamp}@example.com` }]);
    // Hand the row to the member, as routing would have.
    await adminDb().execute(
      sql`update contacts set owner_user_id = ${member.userId} where import_batch_id = ${batchId}`,
    );
    await finishImport(admin, batchId);
    await finishImport(admin, batchId);
    await expectCode(() => chunk(admin, batchId, [{ fullName: 'Late' }]), 'CONFLICT');
    const notices = (await adminDb().execute(
      sql`select title from notifications where user_id = ${member.userId} and dedupe_key = ${`import:${batchId}`}`,
    )) as unknown as { title: string }[];
    expect(notices).toHaveLength(1);
    expect(notices[0]!.title).toContain('1 new lead');
  });
});
