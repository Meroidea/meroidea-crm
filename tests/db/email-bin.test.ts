import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import {
  binEmailThreads,
  emptyEmailBin,
  purgeEmailThreads,
  restoreEmailThreads,
  setEmailImportant,
} from '@/modules/social/bin-service';
import { purgeExpiredEmailBin } from '@/modules/social/bin-sweep';
import { recordMessage } from '@/modules/social/ingest';
import { countEmailUnread, listConversations } from '@/modules/social/queries';
import { inboxFiltersSchema } from '@/modules/social/schemas';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

// Bin and Important in Email (ADR-093) against the real database, RLS and the bin guard trigger.

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;
const rows = async <T>(query: ReturnType<typeof sql>) =>
  (await adminDb().execute(query)) as unknown as T[];

async function expectCode(run: () => Promise<unknown>, code: AppError['code']) {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

let tenantId: string;
let otherTenant: string;
const users: string[] = [];
const otherUsers: string[] = [];
let owner: TenantContext;
let manager: TenantContext;
let member: TenantContext;
let outsider: TenantContext;
let accountId: string;
let contactId: string;
let sequence = 0;

/** A received email thread from a contact (so it sits in Customers), unread. */
async function thread(subject: string): Promise<string> {
  sequence += 1;
  const email = `c${sequence}-${stamp}@example.com`;
  const [row] = await rows<{ id: string }>(sql`
    insert into social_conversations (tenant_id, account_id, participant_id, participant_email,
      participant_name, subject, contact_id, last_message_at, last_inbound_at, unread_count)
    values (${tenantId}, ${accountId}, ${`email:${email}`}, ${email}, 'Kim Example', ${subject},
      ${contactId}, now(), now(), 1) returning id`);
  await adminDb().execute(sql`
    insert into social_messages (tenant_id, conversation_id, account_id, direction, body, sent_at,
      status, attachments)
    values (${tenantId}, ${row!.id}, ${accountId}, 'inbound', 'Hello', now(), 'received',
      ${JSON.stringify([{ storagePath: `${tenantId}/social/${row!.id}/in-${sequence}.png` }])}::jsonb)`);
  return row!.id;
}

const ids = async (ctx: TenantContext, folder: string) =>
  (await listConversations(ctx, inboxFiltersSchema.parse({ folder }), 'email')).rows.map(
    (row) => row.id,
  );

beforeAll(async () => {
  const one = await createWorkspace(`Bin Co ${stamp}`, mail('bin-owner'));
  tenantId = one.tenantId;
  users.push(one.ownerId);
  const two = await createWorkspace(`Bin Other ${stamp}`, mail('bin-other'));
  otherTenant = two.tenantId;
  otherUsers.push(two.ownerId);
  const managerId = await addMember(tenantId, mail('bin-manager'), 'Morgan Manager', 'manager');
  const memberId = await addMember(tenantId, mail('bin-member'), 'Mia Member', 'member');
  users.push(managerId, memberId);
  owner = await contextFor(one.ownerId, tenantId);
  manager = await contextFor(managerId, tenantId);
  member = await contextFor(memberId, tenantId);
  outsider = await contextFor(two.ownerId, otherTenant);
  const [account] = await rows<{ id: string }>(sql`
    insert into social_accounts (tenant_id, platform, external_id, name, username)
    values (${tenantId}, 'email', ${`bin-${stamp}@inbox.example.com`}, 'Harbour',
      ${`bin-${stamp}@inbox.example.com`}) returning id`);
  accountId = account!.id;
  const [contact] = await rows<{ id: string }>(sql`
    insert into contacts (tenant_id, first_name, email, email_normalized)
    values (${tenantId}, 'Kim', ${mail('kim')}, ${mail('kim')}) returning id`);
  contactId = contact!.id;
});

afterAll(async () => {
  await destroyWorkspace(tenantId, users);
  await destroyWorkspace(otherTenant, otherUsers);
});

describe('the Bin', () => {
  it('moves a thread out of its folder into the Bin, and back on restore', async () => {
    const id = await thread('Move me');
    expect(await ids(manager, 'customers')).toContain(id);
    await binEmailThreads(manager, { conversationIds: [id] });
    expect(await ids(manager, 'customers')).not.toContain(id);
    expect(await ids(manager, 'bin')).toContain(id);
    expect((await countEmailUnread(manager)).customers).toBe(0);
    await restoreEmailThreads(manager, { conversationIds: [id] });
    expect(await ids(manager, 'customers')).toContain(id);
    expect(await ids(manager, 'bin')).not.toContain(id);
    const [log] = await rows<{ action: string }>(sql`
      select action from audit_logs where tenant_id = ${tenantId} and entity_id = ${id}
      order by created_at desc limit 1`);
    expect(log?.action).toBe('restore');
  });

  it('the database chooses when a thread went in the Bin, so its 30 days cannot be shortened', async () => {
    const id = await thread('Backdated');
    await withRls(manager, (tx) =>
      tx.execute(sql`update social_conversations set deleted_at = now() - interval '60 days'
        where id = ${id}`),
    );
    const [row] = await rows<{ age: number }>(sql`
      select extract(epoch from now() - deleted_at)::int as age from social_conversations
      where id = ${id}`);
    expect(row!.age).toBeLessThan(60);
    const swept = await purgeExpiredEmailBin();
    expect(swept.deleted).toBe(0);
    expect(await ids(manager, 'bin')).toContain(id);
  });

  it('a session cannot put a social media conversation in the Bin', async () => {
    const [social] = await rows<{ id: string }>(sql`
      insert into social_accounts (tenant_id, platform, external_id, name)
      values (${tenantId}, 'whatsapp', ${`9${stamp}`}, 'Harbour WhatsApp') returning id`);
    const [chat] = await rows<{ id: string }>(sql`
      insert into social_conversations (tenant_id, account_id, participant_id, participant_phone)
      values (${tenantId}, ${social!.id}, ${`614${stamp}`.slice(0, 15)}, '61400000000') returning id`);
    const refused = await withRls(manager, (tx) =>
      tx.execute(sql`update social_conversations set deleted_at = now() where id = ${chat!.id}`),
    ).then(
      () => false,
      () => true,
    );
    expect(refused).toBe(true);
    await expectCode(() => binEmailThreads(manager, { conversationIds: [chat!.id] }), 'NOT_FOUND');
  });

  it('a new email from the customer takes the thread out of the Bin', async () => {
    const id = await thread('Comes back');
    await binEmailThreads(manager, { conversationIds: [id] });
    await recordMessage(
      adminDb(),
      { tenantId, accountId, conversationId: id },
      {
        externalId: `re_back_${stamp}`,
        direction: 'inbound',
        body: 'Any news?',
        attachments: [],
        sentAt: new Date(),
      },
      { countUnread: true },
    );
    expect(await ids(manager, 'customers')).toContain(id);
    expect(await ids(manager, 'bin')).not.toContain(id);
  });
});

describe('deleting forever', () => {
  it('needs social.manage, and only from the Bin', async () => {
    const id = await thread('Forever');
    await expectCode(() => purgeEmailThreads(manager, { conversationIds: [id] }), 'FORBIDDEN');
    await expectCode(() => purgeEmailThreads(owner, { conversationIds: [id] }), 'NOT_FOUND');
    const refused = await withRls(owner, (tx) =>
      tx.execute(sql`select app.email_purge_thread(${id}::uuid)`),
    ).then(
      () => false,
      () => true,
    );
    expect(refused).toBe(true);
  });

  it('deletes the thread and its messages, keeping a ticket made from it', async () => {
    const id = await thread('Gone');
    const [ticket] = await rows<{ id: string }>(sql`
      insert into tickets (tenant_id, number, public_token, subject, conversation_id, requester_name)
      values (${tenantId}, 9001, ${`tok-${stamp}-abcdefghijklmnop`}, 'From email', ${id}, 'Kim') returning id`);
    await binEmailThreads(owner, { conversationIds: [id] });
    expect(await purgeEmailThreads(owner, { conversationIds: [id] })).toEqual({ deleted: 1 });
    expect(await rows(sql`select 1 from social_conversations where id = ${id}`)).toHaveLength(0);
    expect(
      await rows(sql`select 1 from social_messages where conversation_id = ${id}`),
    ).toHaveLength(0);
    const [kept] = await rows<{ conversation_id: string | null }>(sql`
      select conversation_id from tickets where id = ${ticket!.id}`);
    expect(kept).toEqual({ conversation_id: null });
  });

  it('lists the thread’s files for removal, except one a signature still uses', async () => {
    const id = await thread('Files');
    const kept = `${tenantId}/social/compose/${owner.userId}/logo-${stamp}.png`;
    await adminDb().execute(sql`
      update social_messages set attachments = attachments || ${JSON.stringify([{ storagePath: kept }])}::jsonb
      where conversation_id = ${id}`);
    await adminDb().execute(sql`
      insert into email_signatures (tenant_id, user_id, doc)
      values (${tenantId}, ${owner.userId},
        ${JSON.stringify([{ type: 'image', path: kept, alt: '' }])}::jsonb)
      on conflict do nothing`);
    await adminDb().execute(
      sql`update social_conversations set deleted_at = now() where id = ${id}`,
    );
    const paths = await rows<{ path: string }>(sql`
      select path from app.email_delete_thread_rows(${tenantId}::uuid, ${id}::uuid) as path`);
    expect(paths.map((row) => row.path)).toEqual([expect.stringContaining(`/social/${id}/in-`)]);
  });

  it('Empty Bin deletes everything in the Bin and nothing else', async () => {
    const binned = await thread('In bin');
    const live = await thread('Not in bin');
    await binEmailThreads(owner, { conversationIds: [binned] });
    const { deleted } = await emptyEmailBin(owner);
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await ids(owner, 'bin')).toEqual([]);
    expect(await ids(owner, 'customers')).toContain(live);
  });

  it('the daily sweep deletes threads in the Bin for over 30 days, and not newer ones', async () => {
    const old = await thread('Old');
    const recent = await thread('Recent');
    await adminDb().execute(sql`
      update social_conversations set deleted_at = now() - interval '31 days' where id = ${old}`);
    await adminDb().execute(sql`
      update social_conversations set deleted_at = now() - interval '29 days' where id = ${recent}`);
    const { deleted } = await purgeExpiredEmailBin();
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await rows(sql`select 1 from social_conversations where id = ${old}`)).toHaveLength(0);
    expect(await ids(owner, 'bin')).toContain(recent);
    const [log] = await rows<{ actor_type: string }>(sql`
      select actor_type from audit_logs where tenant_id = ${tenantId} and entity_id = ${old}
      order by created_at desc limit 1`);
    expect(log?.actor_type).toBe('system');
  });
});

describe('Important', () => {
  it('shows a thread in Important as well as its own folder, for the whole team', async () => {
    const id = await thread('Big order');
    await setEmailImportant(manager, { conversationIds: [id], important: true });
    expect(await ids(owner, 'important')).toContain(id);
    expect(await ids(owner, 'customers')).toContain(id);
    expect((await countEmailUnread(owner)).important).toBeGreaterThanOrEqual(1);
    await binEmailThreads(owner, { conversationIds: [id] });
    expect(await ids(owner, 'important')).not.toContain(id);
    await restoreEmailThreads(owner, { conversationIds: [id] });
    await setEmailImportant(owner, { conversationIds: [id], important: false });
    expect(await ids(owner, 'important')).not.toContain(id);
  });
});

describe('who may use the Bin', () => {
  it('a person without inbox permissions is refused', async () => {
    const id = await thread('Members');
    await expectCode(() => binEmailThreads(member, { conversationIds: [id] }), 'FORBIDDEN');
    await expectCode(
      () => setEmailImportant(member, { conversationIds: [id], important: true }),
      'FORBIDDEN',
    );
  });

  it('another business cannot bin, restore, flag or delete the thread', async () => {
    const id = await thread('Private');
    await expectCode(() => binEmailThreads(outsider, { conversationIds: [id] }), 'NOT_FOUND');
    await expectCode(
      () => setEmailImportant(outsider, { conversationIds: [id], important: true }),
      'NOT_FOUND',
    );
    await adminDb().execute(
      sql`update social_conversations set deleted_at = now() where id = ${id}`,
    );
    await expectCode(() => restoreEmailThreads(outsider, { conversationIds: [id] }), 'NOT_FOUND');
    await expectCode(() => purgeEmailThreads(outsider, { conversationIds: [id] }), 'NOT_FOUND');
    const refused = await withRls(outsider, (tx) =>
      tx.execute(sql`select app.email_purge_thread(${id}::uuid)`),
    ).then(
      () => false,
      () => true,
    );
    expect(refused).toBe(true);
    expect(await rows(sql`select 1 from social_conversations where id = ${id}`)).toHaveLength(1);
  });
});
