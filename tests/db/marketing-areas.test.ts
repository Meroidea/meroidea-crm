import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import { anonymizeContact } from '@/modules/contacts/privacy';
import { markNotCustomer, moveSenderBack } from '@/modules/social/email-triage';
import {
  countEmailUnread,
  countUnread,
  listConversations,
  senderMarkedNotCustomer,
} from '@/modules/social/queries';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

// The Marketing areas (ADR-073): the Social inbox without email, and Email sorted into Customers,
// To review and Filtered, with "Not a customer" rules. Real database, real row-level security.

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let tenantId: string;
let otherTenant: string;
const users: string[] = [];
const otherUsers: string[] = [];
let owner: TenantContext;
let manager: TenantContext;
let member: TenantContext;
let outsider: TenantContext;
let emailAccount: string;
let whatsappAccount: string;
let contactId: string;
const threads: Record<string, string> = {};

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

let sequence = 0;
async function account(tenant: string, platform: string): Promise<string> {
  const [row] = await rows<{ id: string }>(sql`
    insert into social_accounts (tenant_id, platform, external_id, name)
    values (${tenant}, ${platform}, ${`${platform}-${stamp}-${(sequence += 1)}`}, ${platform})
    returning id`);
  return row!.id;
}

/** A conversation with one inbound message; `automated` marks it as a machine's email. */
async function thread(options: {
  tenant?: string;
  accountId: string;
  email?: string | null;
  contact?: string | null;
  automated?: boolean;
  unread?: number;
}): Promise<string> {
  const tenant = options.tenant ?? tenantId;
  sequence += 1;
  const [row] = await rows<{ id: string }>(sql`
    insert into social_conversations (tenant_id, account_id, participant_id, participant_email,
      contact_id, unread_count, last_message_at)
    values (${tenant}, ${options.accountId}, ${`p-${stamp}-${sequence}`}, ${options.email ?? null},
      ${options.contact ?? null}, ${options.unread ?? 0}, now())
    returning id`);
  const meta = options.email
    ? JSON.stringify({ from: options.email, verified: true, automated: options.automated ?? false })
    : null;
  await adminDb().execute(sql`
    insert into social_messages (tenant_id, conversation_id, account_id, external_id, direction,
      body, sent_at, status, email_meta)
    values (${tenant}, ${row!.id}, ${options.accountId}, ${`m-${stamp}-${sequence}`}, 'inbound',
      'Hello', now(), 'received', ${meta}::jsonb)`);
  return row!.id;
}

const ids = async (ctx: TenantContext, folder?: 'customers' | 'review' | 'filtered') =>
  (await listConversations(ctx, { view: 'all', folder }, 'email')).rows.map((row) => row.id);

beforeAll(async () => {
  const one = await createWorkspace(`Areas Co ${stamp}`, mail('ar-owner'));
  tenantId = one.tenantId;
  users.push(one.ownerId);
  const two = await createWorkspace(`Areas Other ${stamp}`, mail('ar-other'));
  otherTenant = two.tenantId;
  otherUsers.push(two.ownerId);
  const managerId = await addMember(tenantId, mail('ar-manager'), 'Max Manager', 'manager');
  const memberId = await addMember(tenantId, mail('ar-member'), 'Mo Member', 'member');
  users.push(managerId, memberId);
  owner = await contextFor(one.ownerId, tenantId);
  manager = await contextFor(managerId, tenantId);
  member = await contextFor(memberId, tenantId);
  outsider = await contextFor(two.ownerId, otherTenant);

  emailAccount = await account(tenantId, 'email');
  whatsappAccount = await account(tenantId, 'whatsapp');
  const [contact] = await rows<{ id: string }>(sql`
    insert into contacts (tenant_id, first_name, email, email_normalized)
    values (${tenantId}, 'Cass', ${mail('customer')}, ${mail('customer')}) returning id`);
  contactId = contact!.id;

  threads.customer = await thread({
    accountId: emailAccount,
    email: mail('customer'),
    contact: contactId,
    unread: 1,
  });
  threads.stranger = await thread({ accountId: emailAccount, email: mail('stranger'), unread: 2 });
  threads.vendor = await thread({ accountId: emailAccount, email: mail('vendor') });
  threads.bounce = await thread({
    accountId: emailAccount,
    email: mail('mailer-daemon'),
    automated: true,
    unread: 1,
  });
  threads.whatsapp = await thread({ accountId: whatsappAccount, unread: 3 });
});

afterAll(async () => {
  await destroyWorkspace(tenantId, users);
  await destroyWorkspace(otherTenant, otherUsers);
});

describe('two areas', () => {
  it('the Social inbox never lists email, whatever filter is asked for', async () => {
    const social = (await listConversations(owner, { view: 'all' }, 'social')).rows;
    expect(social.map((row) => row.id)).toEqual([threads.whatsapp]);
    const asked = await listConversations(owner, { view: 'all', platform: 'email' }, 'social');
    expect(asked.rows.every((row) => row.platform !== 'email')).toBe(true);
  });

  it('the Social inbox counts unread per channel, without email', async () => {
    const unread = await countUnread(owner);
    expect(unread).toEqual({ total: 1, byPlatform: { whatsapp: 1 } });
  });
});

describe('email folders', () => {
  it('a contact’s thread is in Customers, a stranger’s in To review, a bounce in Filtered', async () => {
    expect(await ids(owner)).toEqual([threads.customer]);
    expect((await ids(owner, 'review')).sort()).toEqual([threads.stranger, threads.vendor].sort());
    expect(await ids(owner, 'filtered')).toEqual([threads.bounce]);
  });

  it('counts unread threads per folder', async () => {
    expect(await countEmailUnread(owner)).toEqual({ customers: 1, review: 1, filtered: 1 });
  });

  it('“Not a customer” moves the sender to Filtered, with later emails, until moved back', async () => {
    await markNotCustomer(manager, threads.vendor!);
    expect(await ids(owner, 'review')).toEqual([threads.stranger]);
    expect(await ids(owner, 'filtered')).toContain(threads.vendor);
    expect(await senderMarkedNotCustomer(owner, mail('vendor'))).toBe(true);

    // A later email from the same address is received and kept, out of the way.
    const later = await thread({ accountId: emailAccount, email: mail('vendor') });
    expect(await ids(owner, 'filtered')).toContain(later);
    expect(await ids(owner, 'review')).not.toContain(later);

    await moveSenderBack(manager, later);
    expect((await ids(owner, 'review')).sort()).toEqual(
      [threads.stranger, threads.vendor, later].sort(),
    );
  });

  it('marking twice is harmless, and is audited without the address', async () => {
    await markNotCustomer(owner, threads.vendor!);
    await markNotCustomer(owner, threads.vendor!);
    const audits = await rows<{ context: Record<string, unknown> }>(sql`
      select context from audit_logs
      where tenant_id = ${tenantId} and entity_type = 'email_sender_rule' and action = 'create'`);
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain(mail('vendor'));
    await moveSenderBack(owner, threads.vendor!);
  });

  it('a sender linked to a contact cannot be marked, and stays in Customers', async () => {
    await expectCode(() => markNotCustomer(owner, threads.customer!), 'CONFLICT');
    expect(await ids(owner)).toEqual([threads.customer]);
  });

  it('a social conversation is not an email thread', async () => {
    await expectCode(() => markNotCustomer(owner, threads.whatsapp!), 'NOT_FOUND');
  });
});

describe('who may sort email', () => {
  it('someone without social.reply cannot mark a sender', async () => {
    await expectCode(() => markNotCustomer(member, threads.stranger!), 'FORBIDDEN');
    await expect(
      withRls(member, (tx) =>
        tx.execute(sql`insert into email_sender_rules (tenant_id, email, created_by)
                       values (${tenantId}, ${mail('x')}, ${member.userId})`),
      ),
    ).rejects.toThrow();
  });

  it('another business cannot mark this business’s senders (cross-tenant)', async () => {
    await expectCode(() => markNotCustomer(outsider, threads.stranger!), 'NOT_FOUND');
    await expect(
      withRls(outsider, (tx) =>
        tx.execute(sql`insert into email_sender_rules (tenant_id, email, created_by)
                       values (${tenantId}, ${mail('y')}, ${outsider.userId})`),
      ),
    ).rejects.toThrow();
  });

  it('another business cannot read this business’s rules or threads', async () => {
    await markNotCustomer(owner, threads.stranger!);
    const seen = (await withRls(outsider, (tx) =>
      tx.execute(sql`select id from email_sender_rules where tenant_id = ${tenantId}`),
    )) as unknown[];
    expect(seen).toHaveLength(0);
    expect(await ids(outsider, 'filtered')).toEqual([]);
    await moveSenderBack(owner, threads.stranger!);
  });

  it('nobody can create a rule in someone else’s name', async () => {
    await expect(
      withRls(manager, (tx) =>
        tx.execute(sql`insert into email_sender_rules (tenant_id, email, created_by)
                       values (${tenantId}, ${mail('z')}, ${owner.userId})`),
      ),
    ).rejects.toThrow();
  });

  it('with email switched off, its rules are out of reach', async () => {
    await markNotCustomer(owner, threads.vendor!);
    await adminDb().execute(
      sql`update tenants set features = array_remove(features, 'email_channel') where id = ${tenantId}`,
    );
    try {
      const seen = (await withRls(owner, (tx) =>
        tx.execute(sql`select id from email_sender_rules where tenant_id = ${tenantId}`),
      )) as unknown[];
      expect(seen).toHaveLength(0);
    } finally {
      await adminDb().execute(
        sql`update tenants set features = features || array['email_channel'] where id = ${tenantId}`,
      );
    }
    await moveSenderBack(owner, threads.vendor!);
  });
});

describe('erasure', () => {
  it('erasing a contact deletes a rule naming their email address', async () => {
    const email = mail('erase-me');
    const [contact] = await rows<{ id: string }>(sql`
      insert into contacts (tenant_id, first_name, email, email_normalized)
      values (${tenantId}, 'Eve', ${email}, ${email}) returning id`);
    const unlinked = await thread({ accountId: emailAccount, email });
    await markNotCustomer(owner, unlinked);
    await anonymizeContact(owner, contact!.id);
    const left = await rows(sql`
      select 1 from email_sender_rules where tenant_id = ${tenantId} and email = ${email}`);
    expect(left).toHaveLength(0);
  });
});
