import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { getTimeline } from '@/modules/activities/queries';
import { exportAuditLog } from '@/modules/audit/export';
import { getAuditFacets, listAuditEntries } from '@/modules/audit/queries';
import { anonymizeContact, mergeContacts } from '@/modules/contacts/privacy';
import { createContactSchema, updateContactSchema } from '@/modules/contacts/schemas';
import { createContact, updateContact } from '@/modules/contacts/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import {
  addMember,
  contextFor,
  createAuthUser,
  createWorkspace,
  destroyWorkspace,
} from '../support/workspaces';

// The audit log viewer (milestone 14, ADR-063): only audit.view reads the log, in the
// application and in the database.

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let tenantId: string;
let otherTenant: string;
const users: string[] = [];
const otherUsers: string[] = [];
let admin: TenantContext;
let staff: TenantContext;
let colleague: TenantContext;
let privacyOfficer: TenantContext;
let auditor: TenantContext;
let outsider: TenantContext;
let leaverId: string;
const probeRecord = crypto.randomUUID();

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

/** Rows a session can read straight from the table, with no application check in the way. */
async function visibleEntries(ctx: TenantContext, tenant: string): Promise<number> {
  const rows = (await withRls(ctx, (tx) =>
    tx.execute(sql`select count(*)::int as n from audit_logs where tenant_id = ${tenant}`),
  )) as unknown as { n: number }[];
  return rows[0]?.n ?? -1;
}

async function writeEntry(fields: {
  actor?: string | null;
  action?: string;
  type?: string;
  record?: string | null;
  at: string;
  changes?: Record<string, unknown>;
  context?: Record<string, unknown>;
}) {
  await adminDb().execute(sql`
    insert into audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, changes,
                            context, created_at)
    values (${tenantId}, ${fields.actor ?? null}, ${fields.action ?? 'update'},
            ${fields.type ?? 'probe'}, ${fields.record ?? null},
            ${fields.changes ? JSON.stringify(fields.changes) : null}::jsonb,
            ${fields.context ? JSON.stringify(fields.context) : null}::jsonb,
            ${fields.at}::timestamptz)`);
}

/** A member whose role holds exactly these grants. */
async function addCustomMember(
  key: string,
  fullName: string,
  grants: [permission: string, scope: string | null][],
): Promise<string> {
  const userId = await createAuthUser(mail(`audit-${key}`), fullName);
  const values = grants.map(([permission, scope]) => sql`(${permission}, ${scope})`);
  await adminDb().execute(sql`
    with role as (
      insert into roles (tenant_id, key, name, is_system)
      values (${tenantId}, ${key}, ${fullName}, false)
      returning id
    ), grants as (
      insert into role_permissions (tenant_id, role_id, permission, scope)
      select ${tenantId}, role.id, p.permission, p.scope::permission_scope
      from role cross join (values ${sql.join(values, sql`, `)}) as p(permission, scope)
    )
    insert into tenant_memberships (tenant_id, user_id, role_id, status)
    select ${tenantId}, ${userId}, role.id, 'active' from role`);
  return userId;
}

const person = (ctx: TenantContext, fields: Record<string, unknown>) =>
  createContact(ctx, createContactSchema.parse({ confirmDuplicate: true, ...fields }));

beforeAll(async () => {
  const one = await createWorkspace(`Audit Co ${stamp}`, mail('audit-admin'));
  tenantId = one.tenantId;
  users.push(one.ownerId);
  await adminDb().execute(
    sql`update tenants set timezone = 'Australia/Sydney' where id = ${tenantId}`,
  );
  const two = await createWorkspace(`Audit Other ${stamp}`, mail('audit-other'));
  otherTenant = two.tenantId;
  otherUsers.push(two.ownerId);

  const staffId = await addMember(tenantId, mail('audit-staff'), 'Sam Staff', 'member');
  const colleagueId = await addMember(tenantId, mail('audit-colleague'), 'Cal Colleague', 'member');
  leaverId = await addMember(tenantId, mail('audit-leaver'), 'Lee Leaver', 'member');

  // Someone trusted to erase people on request, but not to read the audit log.
  const officerId = await addCustomMember('privacy', 'Pat Privacy', [
    ['contacts.view', 'all'],
    ['contacts.anonymize', null],
  ]);
  // Someone who reads the log and nothing else: not users.manage, so former members' profiles
  // are hidden from them by the `users` policies.
  const auditorId = await addCustomMember('auditor', 'Ari Auditor', [['audit.view', null]]);
  users.push(staffId, colleagueId, leaverId, officerId, auditorId);

  admin = await contextFor(one.ownerId, tenantId);
  staff = await contextFor(staffId, tenantId);
  colleague = await contextFor(colleagueId, tenantId);
  privacyOfficer = await contextFor(officerId, tenantId);
  auditor = await contextFor(auditorId, tenantId);
  outsider = await contextFor(two.ownerId, otherTenant);

  await writeEntry({
    actor: leaverId,
    action: 'delete',
    type: 'probe',
    record: probeRecord,
    at: '2026-03-02T13:30:00Z', // 3 March, 00:30 in Sydney
    changes: { phone: ['0400 000 001', null] },
  });
  await writeEntry({
    actor: one.ownerId,
    action: 'update',
    type: 'probe',
    record: probeRecord,
    at: '2026-03-03T12:59:00Z', // 3 March, 23:59 in Sydney
    changes: { city: ['Sydney', 'Hobart'] },
    context: { reason: 'moved' },
  });
  await writeEntry({
    actor: one.ownerId,
    action: 'create',
    type: 'probe',
    at: '2026-03-03T13:01:00Z', // 4 March, 00:01 in Sydney
  });
  await adminDb().execute(sql`
    update tenant_memberships set status = 'deactivated'
    where tenant_id = ${tenantId} and user_id = ${leaverId}`);
});

afterAll(async () => {
  await destroyWorkspace(tenantId, users);
  await destroyWorkspace(otherTenant, otherUsers);
});

describe('reading the audit log', () => {
  it('shows an admin the business’s entries newest first, filtered by action, person and record', async () => {
    const all = await listAuditEntries(admin, { type: 'probe' });
    expect(all.entries.map((entry) => entry.action)).toEqual(['create', 'update', 'delete']);
    expect(all.entries[1]).toMatchObject({
      changes: { city: ['Sydney', 'Hobart'] },
      context: { reason: 'moved' },
      entityId: probeRecord,
    });

    const deletes = await listAuditEntries(admin, { type: 'probe', action: 'delete' });
    expect(deletes.entries).toHaveLength(1);
    const byAdmin = await listAuditEntries(admin, { type: 'probe', person: admin.userId });
    expect(byAdmin.entries.map((entry) => entry.action)).toEqual(['create', 'update']);
    const oneRecord = await listAuditEntries(admin, { record: probeRecord });
    expect(oneRecord.entries.map((entry) => entry.action)).toEqual(['update', 'delete']);
  });

  it('reads whole days in the business’s timezone', async () => {
    const third = await listAuditEntries(admin, {
      type: 'probe',
      from: '2026-03-03',
      to: '2026-03-03',
    });
    expect(third.entries.map((entry) => entry.action)).toEqual(['update', 'delete']);
    const fourth = await listAuditEntries(admin, { type: 'probe', from: '2026-03-04' });
    expect(fourth.entries.map((entry) => entry.action)).toEqual(['create']);
  });

  it('names people who have since left, to an auditor who cannot see their profile', async () => {
    const profiles = (await withRls(auditor, (tx) =>
      tx.execute(sql`select id from users where id = ${leaverId}`),
    )) as unknown as unknown[];
    expect(profiles).toHaveLength(0);

    const deletes = await listAuditEntries(auditor, { type: 'probe', action: 'delete' });
    expect(deletes.entries[0]?.actorName).toBe('Lee Leaver');
    const facets = await getAuditFacets(auditor);
    expect(facets.people.map((person) => person.name)).toContain('Lee Leaver');
    expect(facets.types).toContain('probe');
  });

  it('pages through entries written in the same millisecond without skipping or repeating any', async () => {
    const values = Array.from(
      { length: 120 },
      (_, index) =>
        sql`(${tenantId}::uuid, 'update', 'paging_probe', ${`2026-04-01T00:00:00.000${String(index % 1000).padStart(3, '0')}Z`}::timestamptz)`,
    );
    await adminDb().execute(sql`
      insert into audit_logs (tenant_id, action, entity_type, created_at)
      values ${sql.join(values, sql`, `)}`);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const result = await listAuditEntries(admin, { type: 'paging_probe', cursor });
      seen.push(...result.entries.map((entry) => entry.id));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
  });

  it('refuses a member without audit.view, and the database shows them nothing either', async () => {
    await expectCode(() => listAuditEntries(staff, {}), 'FORBIDDEN');
    await expectCode(() => getAuditFacets(staff), 'FORBIDDEN');
    await expectCode(() => exportAuditLog(staff, {}), 'FORBIDDEN');
    expect(await visibleEntries(admin, tenantId)).toBeGreaterThan(0);
    expect(await visibleEntries(staff, tenantId)).toBe(0);
  });

  it('gives an admin of another business none of these entries, even by record id', async () => {
    const result = await listAuditEntries(outsider, { record: probeRecord });
    expect(result.entries).toHaveLength(0);
    expect(await visibleEntries(outsider, tenantId)).toBe(0);
    const names = (await withRls(outsider, (tx) =>
      tx.execute(sql`select * from app.audit_actor_names(array[${leaverId}::uuid])`),
    )) as unknown as unknown[];
    expect(names).toHaveLength(0);
  });

  it('exports the filtered entries as CSV and records the export', async () => {
    const result = await exportAuditLog(admin, { type: 'probe', cursor: 'ignored' });
    expect(result).toMatchObject({ rows: 3, truncated: false });
    const [header, ...lines] = result.csv.trim().split(/\r?\n/);
    expect(header).toContain('Time (Australia/Sydney)');
    expect(lines).toHaveLength(3);
    expect(result.csv).toContain('Lee Leaver');

    const recorded = (await adminDb().execute(sql`
      select actor_user_id, context from audit_logs
      where tenant_id = ${tenantId} and action = 'export' and entity_type = 'audit_log'`)) as unknown as {
      actor_user_id: string;
      context: { rows: number; filters: Record<string, unknown> };
    }[];
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      actor_user_id: admin.userId,
      context: { rows: 3, filters: { type: 'probe' } },
    });
  });
});

describe('features that read the log without audit.view', () => {
  it('still tell a record’s owner which fields changed, without the values', async () => {
    const { id } = await person(staff, { firstName: 'Tia', lastName: 'Timeline' });
    await updateContact(
      staff,
      updateContactSchema.parse({ id, firstName: 'Tia', lastName: 'Timeline', city: 'Perth' }),
    );

    const timeline = await getTimeline(staff, { contactId: id });
    const edit = timeline.find((item) => item.type === 'field_changed');
    expect(edit?.subject).toMatch(/city/);
    expect(edit?.actorName).toBe('Sam Staff');

    const rows = (await withRls(staff, (tx) =>
      tx.execute(sql`select * from app.record_field_changes('contact', ${id}::uuid)`),
    )) as unknown as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0]!).sort()).toEqual(['actor_user_id', 'created_at', 'fields', 'id']);
    expect(JSON.stringify(rows)).not.toContain('Perth');
  });

  it('keep a colleague from reading what was changed on someone else’s contact', async () => {
    const { id } = await person(staff, { firstName: 'Una', lastName: 'Unseen' });
    await updateContact(
      staff,
      updateContactSchema.parse({ id, firstName: 'Una', lastName: 'Unseen', city: 'Darwin' }),
    );
    const leaked = (await withRls(colleague, (tx) =>
      tx.execute(sql`select changes from audit_logs where entity_id = ${id}`),
    )) as unknown as unknown[];
    expect(leaked).toHaveLength(0);
    await expectCode(() => listAuditEntries(colleague, { record: id }), 'FORBIDDEN');
  });

  it('still erase every record merged into a person, for someone who cannot read the log', async () => {
    const keep = await person(admin, { firstName: 'Mo', lastName: 'Merged', city: 'Cairns' });
    const drop = await person(admin, { firstName: 'Moe', lastName: 'Merged', city: 'Cairns' });
    await mergeContacts(admin, { keepId: keep.id, dropId: drop.id });
    expect(await visibleEntries(privacyOfficer, tenantId)).toBe(0);
    const merged = async (ctx: TenantContext) =>
      (
        (await withRls(ctx, (tx) =>
          tx.execute(sql`select id from app.contacts_merged_into(${keep.id}::uuid) as id`),
        )) as unknown as { id: string }[]
      ).map((row) => row.id);
    expect(await merged(privacyOfficer)).toEqual([drop.id]);
    // Someone who may not erase learns nothing about merges from it.
    expect(await merged(staff)).toEqual([]);

    await anonymizeContact(privacyOfficer, keep.id);

    const rows = (await adminDb().execute(sql`
      select id, first_name, last_name, city from contacts where id in (${keep.id}, ${drop.id})`)) as unknown as {
      first_name: string;
      last_name: string | null;
      city: string | null;
    }[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ first_name: 'Erased', last_name: null, city: null });
    }
  });
});
