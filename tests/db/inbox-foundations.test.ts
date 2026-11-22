import { createHmac } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { POST as metaWebhook } from '@/app/api/webhooks/meta/route';
import { AppError } from '@/lib/errors';
import {
  conversationsForContact,
  getConversation,
  listCannedResponses,
} from '@/modules/social/queries';
import { linkConversationContact } from '@/modules/social/service';
import {
  addNote,
  deleteCannedResponse,
  saveCannedResponse,
  setAccountSettings,
} from '@/modules/social/team-service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

// Inbox foundations (ADR-068): private notes, saved replies, finding the sender's contact, the
// contact's timeline and the presence channel. The database, row-level security, the webhook
// route and the services are the real ones; no provider is called.

vi.hoisted(() => {
  process.env.META_APP_ID = 'meta-app-1';
  process.env.META_APP_SECRET = 'meta-secret-0123456789abcdef';
  process.env.META_WEBHOOK_VERIFY_TOKEN = 'verify-token-0123456789';
});

const stamp = Date.now();
const tail = String(stamp).slice(-6);
const mail = (name: string) => `${name}-${stamp}@example.com`;
const NUMBER = `4${stamp}`;
const KNOWN = `61400${tail}`;
const SHARED = `61401${tail}`;
const UNKNOWN = `61402${tail}`;
const QUIET = `61403${tail}`;

let tenantId: string;
let otherTenant: string;
let accountId: string;
const users: string[] = [];
const otherUsers: string[] = [];
let owner: TenantContext;
let manager: TenantContext;
let agentA: TenantContext;
let agentB: TenantContext;
let viewer: TenantContext;
let outsider: TenantContext;

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

async function sqlState(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const wrapped = error as { code?: string; cause?: { code?: string } };
    return wrapped.cause?.code ?? wrapped.code ?? 'unknown';
  }
  return 'OK';
}

function signed(body: unknown) {
  const raw = JSON.stringify(body);
  const signature = createHmac('sha256', process.env.META_APP_SECRET!).update(raw).digest('hex');
  return new Request('http://localhost:3000/api/webhooks/meta', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${signature}` },
    body: raw,
  });
}

let sequence = 0;
/** One customer message arriving through the real, signed WhatsApp webhook. */
async function customerWrites(from: string, name: string, text = 'Hello there') {
  sequence += 1;
  const body = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: `waba-${stamp}`,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '61400000000', phone_number_id: NUMBER },
              contacts: [{ profile: { name }, wa_id: from }],
              messages: [
                {
                  from,
                  id: `wamid.F${stamp}.${sequence}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  expect((await metaWebhook(signed(body))).status).toBe(200);
}

async function conversationFor(phone: string) {
  const [row] = await rows<{ id: string; contact_id: string | null; contact_match: string | null }>(
    sql`select id, contact_id, contact_match from social_conversations
        where tenant_id = ${tenantId} and participant_phone = ${phone}`,
  );
  return row;
}

async function addContact(tenant: string, firstName: string, phone: string) {
  const [row] = await rows<{ id: string }>(sql`
    insert into contacts (tenant_id, first_name, phone, phone_e164)
    values (${tenant}, ${firstName}, ${`+${phone}`}, ${`+${phone}`}) returning id`);
  return row!.id;
}

beforeAll(async () => {
  const one = await createWorkspace(`Inbox Co ${stamp}`, mail('in-owner'));
  tenantId = one.tenantId;
  users.push(one.ownerId);
  const two = await createWorkspace(`Inbox Other ${stamp}`, mail('in-other'));
  otherTenant = two.tenantId;
  otherUsers.push(two.ownerId);
  const managerId = await addMember(tenantId, mail('in-manager'), 'Morgan Manager', 'manager');
  const aId = await addMember(tenantId, mail('in-agent-a'), 'Avery Agent', 'member');
  const bId = await addMember(tenantId, mail('in-agent-b'), 'Blair Agent', 'member');
  users.push(managerId, aId, bId);
  // Staff answer the inbox in this business, without managing shared replies.
  await adminDb().execute(sql`
    insert into role_permissions (tenant_id, role_id, permission, scope)
    select tenant_id, id, p, null from roles, unnest(array['social.view', 'social.reply']) p
    where tenant_id = ${tenantId} and key = 'member'
    on conflict do nothing`);
  // A role that may read the inbox but not reply.
  const viewerId = await addMember(tenantId, mail('in-viewer'), 'Val Viewer', 'member');
  users.push(viewerId);
  await adminDb().execute(sql`
    with role as (
      insert into roles (tenant_id, key, name, is_system)
      values (${tenantId}, 'inbox_reader', 'Inbox reader', false) returning id
    ), grants as (
      insert into role_permissions (tenant_id, role_id, permission, scope)
      select ${tenantId}, id, 'social.view', null from role
    )
    update tenant_memberships set role_id = (select id from role)
    where tenant_id = ${tenantId} and user_id = ${viewerId}`);

  owner = await contextFor(one.ownerId, tenantId);
  manager = await contextFor(managerId, tenantId);
  agentA = await contextFor(aId, tenantId);
  agentB = await contextFor(bId, tenantId);
  viewer = await contextFor(viewerId, tenantId);
  outsider = await contextFor(two.ownerId, otherTenant);

  const [account] = await rows<{ id: string }>(sql`
    insert into social_accounts (tenant_id, platform, external_id, name, provider_business_id)
    values (${tenantId}, 'whatsapp', ${NUMBER}, 'Harbour Cafe', ${`waba-${stamp}`})
    returning id`);
  accountId = account!.id;
});

afterAll(async () => {
  vi.restoreAllMocks();
  for (const name of ['META_APP_ID', 'META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN']) {
    delete process.env[name];
  }
  await destroyWorkspace(tenantId, users);
  await destroyWorkspace(otherTenant, otherUsers);
});

describe('finding the sender’s contact', () => {
  it('links the one contact with the customer’s WhatsApp number', async () => {
    const contactId = await addContact(tenantId, 'Kim', KNOWN);
    await customerWrites(KNOWN, 'Kim Known');
    const conversation = await conversationFor(KNOWN);
    expect(conversation?.contact_id).toBe(contactId);
    expect(conversation?.contact_match).toBe('auto');
  });

  it('never matches a contact of another business with the same number', async () => {
    const foreign = await addContact(otherTenant, 'Elsewhere', QUIET);
    await customerWrites(QUIET, 'Quinn Quiet');
    const conversation = await conversationFor(QUIET);
    expect(conversation?.contact_id).toBeNull();
    expect(conversation?.contact_id).not.toBe(foreign);
    // Nothing matched and new leads are off: it is looked up again next time.
    expect(conversation?.contact_match).toBeNull();
  });

  it('links nobody when several contacts share the number, and offers them', async () => {
    const first = await addContact(tenantId, 'Sam', SHARED);
    const second = await addContact(tenantId, 'Sasha', SHARED);
    await customerWrites(SHARED, 'Sam or Sasha');
    const conversation = await conversationFor(SHARED);
    expect(conversation?.contact_id).toBeNull();
    expect(conversation?.contact_match).toBe('suggested');
    const thread = await getConversation(owner, conversation!.id);
    expect(thread?.suggestions.map((item) => item.id).sort()).toEqual([first, second].sort());
  });

  it('makes a new lead for an unknown sender only when the account is set to', async () => {
    await setAccountSettings(owner, { accountId, createLeadForUnknown: true, leadSourceId: null });
    await customerWrites(UNKNOWN, 'Uma Unknown', 'My passport number is X1234567');
    const conversation = await conversationFor(UNKNOWN);
    expect(conversation?.contact_match).toBe('created');
    const [contact] = await rows<{
      first_name: string;
      last_name: string | null;
      phone_e164: string;
      lead_status_id: string | null;
    }>(sql`select first_name, last_name, phone_e164, lead_status_id from contacts
           where id = ${conversation!.contact_id}`);
    expect(contact).toMatchObject({
      first_name: 'Uma',
      last_name: 'Unknown',
      phone_e164: `+${UNKNOWN}`,
    });
    expect(contact?.lead_status_id).not.toBeNull();
    // What the customer wrote stays in the conversation only.
    const traces = await rows<{ text: string }>(sql`
      select payload::text as text from lead_intake_events where contact_id = ${conversation!.contact_id}
      union all
      select coalesce(subject, '') || coalesce(body, '') from activities
      where contact_id = ${conversation!.contact_id}`);
    expect(traces.length).toBeGreaterThan(0);
    for (const trace of traces) expect(trace.text).not.toContain('passport');
    await setAccountSettings(owner, { accountId, createLeadForUnknown: false, leadSourceId: null });
  });

  it('never changes a link a person made or removed', async () => {
    const conversation = await conversationFor(KNOWN);
    await linkConversationContact(owner, { conversationId: conversation!.id, contactId: null });
    await customerWrites(KNOWN, 'Kim Known', 'Me again');
    const after = await conversationFor(KNOWN);
    expect(after?.contact_id).toBeNull();
    expect(after?.contact_match).toBe('manual');
  });
});

describe('account settings', () => {
  it('need social.manage, in the service and in the database', async () => {
    const input = { accountId, createLeadForUnknown: true, leadSourceId: null };
    await expectCode(() => setAccountSettings(manager, input), 'FORBIDDEN');
    expect(
      await sqlState(() =>
        withRls(manager, (tx) =>
          tx.execute(
            sql`select app.social_set_account_settings(${accountId}::uuid, '{"createLeadForUnknown": true}'::jsonb)`,
          ),
        ),
      ),
    ).toBe('42501');
    // The column itself is not writable by a session.
    expect(
      await sqlState(() =>
        withRls(owner, (tx) =>
          tx.execute(
            sql`update social_accounts set settings = '{"createLeadForUnknown": true}' where id = ${accountId}`,
          ),
        ),
      ),
    ).toBe('42501');
  });

  it('refuse another business’s lead source', async () => {
    const [source] = await rows<{ id: string }>(
      sql`select id from lead_sources where tenant_id = ${otherTenant} limit 1`,
    );
    await expectCode(
      () =>
        setAccountSettings(owner, {
          accountId,
          createLeadForUnknown: true,
          leadSourceId: source!.id,
        }),
      'VALIDATION',
    );
  });

  it('cannot reach another business’s account', async () => {
    await expectCode(
      () =>
        setAccountSettings(outsider, { accountId, createLeadForUnknown: true, leadSourceId: null }),
      'NOT_FOUND',
    );
  });
});

describe('private notes', () => {
  it('sit in the thread without moving the conversation’s last message', async () => {
    const conversation = await conversationFor(SHARED);
    const [before] = await rows<{ preview: string | null }>(
      sql`select last_message_preview as preview from social_conversations where id = ${conversation!.id}`,
    );
    await addNote(agentA, {
      conversationId: conversation!.id,
      body: 'Check which of the two it is',
    });
    const thread = await getConversation(viewer, conversation!.id);
    const note = thread?.messages.find((message) => message.direction === 'note');
    expect(note?.body).toBe('Check which of the two it is');
    expect(note?.sentByName).toBe('Avery Agent');
    const [after] = await rows<{ preview: string | null }>(
      sql`select last_message_preview as preview from social_conversations where id = ${conversation!.id}`,
    );
    expect(after?.preview).toBe(before?.preview);
  });

  it('need social.reply', async () => {
    const conversation = await conversationFor(SHARED);
    await expectCode(
      () => addNote(viewer, { conversationId: conversation!.id, body: 'x' }),
      'FORBIDDEN',
    );
  });

  it('cannot be added to another business’s conversation', async () => {
    const conversation = await conversationFor(SHARED);
    await expectCode(
      () => addNote(outsider, { conversationId: conversation!.id, body: 'x' }),
      'NOT_FOUND',
    );
  });

  it('are written in their author’s name only, and never changed', async () => {
    const conversation = await conversationFor(SHARED);
    expect(
      await sqlState(() =>
        withRls(agentA, (tx) =>
          tx.execute(sql`
            insert into social_messages (tenant_id, conversation_id, account_id, direction, body,
              sent_at, sent_by_user_id, status)
            values (${tenantId}, ${conversation!.id}, ${accountId}, 'note', 'As Blair',
              now(), ${agentB.userId}, 'sent')`),
        ),
      ),
    ).toBe('42501');
    expect(
      await sqlState(() =>
        withRls(agentA, (tx) =>
          tx.execute(
            sql`update social_messages set body = 'changed' where conversation_id = ${conversation!.id} and direction = 'note'`,
          ),
        ),
      ),
    ).toBe('42501');
  });
});

describe('saved replies', () => {
  let ownId: string;

  it('a person’s own are theirs alone', async () => {
    ({ id: ownId } = await saveCannedResponse(agentA, {
      title: 'Opening hours',
      shortcut: 'hours',
      body: 'Hi {{contact.first_name}}, we open at 8.',
      shared: false,
    }));
    expect((await listCannedResponses(agentA)).map((reply) => reply.id)).toContain(ownId);
    // Another agent in the same business cannot see, change or delete it.
    expect((await listCannedResponses(agentB)).map((reply) => reply.id)).not.toContain(ownId);
    await expectCode(
      () =>
        saveCannedResponse(agentB, {
          id: ownId,
          title: 'Taken over',
          shortcut: null,
          body: 'x',
          shared: false,
        }),
      'NOT_FOUND',
    );
    await expectCode(() => deleteCannedResponse(agentB, ownId), 'NOT_FOUND');
  });

  it('shared ones need social.canned_manage, in the service and in the database', async () => {
    await expectCode(
      () => saveCannedResponse(agentA, { title: 'Team', shortcut: null, body: 'x', shared: true }),
      'FORBIDDEN',
    );
    expect(
      await sqlState(() =>
        withRls(agentA, (tx) =>
          tx.execute(sql`
            insert into social_canned_responses (tenant_id, owner_user_id, title, body)
            values (${tenantId}, null, 'Sneaky', 'x')`),
        ),
      ),
    ).toBe('42501');
    const { id } = await saveCannedResponse(manager, {
      title: 'Thanks',
      shortcut: 'thanks',
      body: 'Thanks, {{agent.name}}',
      shared: true,
    });
    expect((await listCannedResponses(agentB)).find((reply) => reply.id === id)?.shared).toBe(true);
    await expectCode(
      () =>
        saveCannedResponse(agentB, {
          id,
          title: 'Mine now',
          shortcut: null,
          body: 'x',
          shared: false,
        }),
      'FORBIDDEN',
    );
    await expectCode(() => deleteCannedResponse(agentB, id), 'FORBIDDEN');
  });

  it('a shortcut means one reply for whoever can see it', async () => {
    await expectCode(
      () =>
        saveCannedResponse(agentA, { title: 'Again', shortcut: 'hours', body: 'x', shared: false }),
      'DUPLICATE',
    );
    // Someone else's own replies are theirs to name.
    await saveCannedResponse(agentB, {
      title: 'Mine',
      shortcut: 'hours',
      body: 'x',
      shared: false,
    });
  });

  it('are invisible to another business', async () => {
    expect(await listCannedResponses(outsider)).toEqual([]);
    const seen = await withRls(outsider, (tx) =>
      tx.execute(sql`select id from social_canned_responses where tenant_id = ${tenantId}`),
    );
    expect(seen).toHaveLength(0);
    await expectCode(() => deleteCannedResponse(outsider, ownId), 'NOT_FOUND');
  });

  it('are not offered to someone who cannot reply', async () => {
    expect(await listCannedResponses(viewer)).toEqual([]);
  });
});

describe('the contact’s timeline', () => {
  it('lists their conversations for people who can read the inbox, without what was said', async () => {
    const conversation = await conversationFor(UNKNOWN);
    const items = await conversationsForContact(owner, conversation!.contact_id!);
    expect(items).toHaveLength(1);
    expect(items[0]?.href).toBe(`/social/${conversation!.id}`);
    expect(items[0]?.body).toBeNull();
    expect(items[0]?.subject).not.toContain('passport');
    expect(await conversationsForContact(outsider, conversation!.contact_id!)).toEqual([]);
  });
});

describe('the presence channel', () => {
  it('is joined only by people who can read this business’s inbox', async () => {
    const allowed = async (ctx: TenantContext, tenant: string) => {
      const [row] = (await withRls(ctx, (tx) =>
        tx.execute(sql`select app.social_presence_allowed(${`social-presence:${tenant}`}) as ok`),
      )) as unknown as { ok: boolean }[];
      return row?.ok;
    };
    expect(await allowed(viewer, tenantId)).toBe(true);
    expect(await allowed(outsider, tenantId)).toBe(false);
    expect(await allowed(owner, otherTenant)).toBe(false);
  });
});
