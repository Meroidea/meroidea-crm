import { createHmac } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { GET as metaVerify, POST as metaWebhook } from '@/app/api/webhooks/meta/route';
import { POST as tiktokWebhook } from '@/app/api/webhooks/tiktok/route';
import { AppError } from '@/lib/errors';
import { createContactSchema } from '@/modules/contacts/schemas';
import { createContact } from '@/modules/contacts/service';
import { readCredentials } from '@/modules/social/credentials';
import { getConversation, listConversations } from '@/modules/social/queries';
import {
  connectAccounts,
  disconnectAccount,
  linkConversationContact,
  replyToConversation,
} from '@/modules/social/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

// Social inbox (ADR-064). Meta and TikTok are simulated at the network edge only; the database,
// row-level security, the credential functions, the routes and the services are the real ones.

// Before any import reads (and caches) the server environment.
vi.hoisted(() => {
  process.env.META_APP_ID = 'meta-app-1';
  process.env.META_APP_SECRET = 'meta-secret-0123456789abcdef';
  process.env.META_LOGIN_CONFIG_ID = 'config-1';
  process.env.META_WEBHOOK_VERIFY_TOKEN = 'verify-token-0123456789';
  process.env.TIKTOK_APP_ID = 'tiktok-app-1';
  process.env.TIKTOK_APP_SECRET = 'tiktok-secret-0123456789';
  process.env.TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/?client_key=tiktok-app-1';
});

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;
const PAGE = `page-${stamp}`;
const IG = `ig-${stamp}`;
const TT = `tt-${stamp}`;
const REDIRECT = 'http://localhost:3000/api/social/oauth/meta';

let tenantId: string;
let otherTenant: string;
const users: string[] = [];
const otherUsers: string[] = [];
let owner: TenantContext;
let manager: TenantContext;
let staff: TenantContext;
let outsider: TenantContext;

/* ------------------------------------------------------------------ simulated providers */

type Call = { method: string; url: string; body: string };
const calls: Call[] = [];
const realFetch = globalThis.fetch;
type Handler = (call: Call) => unknown | Promise<unknown>;
let routes: [RegExp, Handler][] = [];
const route = (method: string, pattern: RegExp, handler: Handler) =>
  routes.unshift([new RegExp(`^${method} ${pattern.source}`), handler]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function metaHappyPath() {
  route('POST', /https:\/\/graph\.facebook\.com\/v\d+\.\d+\/oauth\/access_token/, () =>
    json({ access_token: 'SYSTEM_USER_TOKEN' }),
  );
  route('GET', /.*\/me\?fields=client_business_id/, () => json({ client_business_id: 'biz-1' }));
  route('GET', /.*\/me\/accounts/, () =>
    json({
      data: [
        {
          id: PAGE,
          name: 'Harbour Cafe',
          access_token: 'PAGE_TOKEN',
          instagram_business_account: { id: IG, username: 'harbourcafe', name: 'Harbour Cafe' },
        },
      ],
    }),
  );
  route('GET', /.*\/me\/assigned_instagram_accounts/, () => json({ data: [] }));
  route('POST', /.*\/subscribed_apps/, () => json({ success: true }));
  route('DELETE', /.*\/subscribed_apps/, () => json({ success: true }));
  route('GET', new RegExp(`.*/${PAGE}/conversations`), () =>
    json({
      data: [
        {
          id: 't_1',
          participants: {
            data: [
              { id: 'PSID1', name: 'Jamie Customer' },
              { id: PAGE, name: 'Harbour Cafe' },
            ],
          },
          messages: {
            data: [
              {
                id: 'm_out_1',
                created_time: '2026-11-17T09:01:00+0000',
                message: 'Yes, we do!',
                from: { id: PAGE },
              },
              {
                id: 'm_in_1',
                created_time: '2026-11-17T09:00:00+0000',
                message: 'Gluten free options?',
                from: { id: 'PSID1' },
              },
            ],
          },
        },
      ],
    }),
  );
  route('GET', new RegExp(`.*/${IG}/conversations`), () =>
    json({
      data: [
        {
          id: 'ig_t_1',
          participants: { data: [{ id: 'IGSID1', username: 'sam.eats' }, { id: IG }] },
          messages: {
            data: [
              {
                id: 'ig_m_1',
                created_time: '2026-11-17T08:00:00+0000',
                message: 'Book for 4?',
                from: { id: 'IGSID1' },
              },
            ],
          },
        },
      ],
    }),
  );
  route('GET', /.*\/PSID2\?fields=/, () => json({ first_name: 'Alex', last_name: 'New' }));
}

beforeAll(async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!/^https:\/\/(graph\.facebook\.com|business-api\.tiktok\.com)\//.test(url)) {
      return realFetch(input, init);
    }
    const call = {
      method: (init?.method ?? 'GET').toUpperCase(),
      url,
      body: typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : '',
    };
    calls.push(call);
    const match = routes.find(([pattern]) => pattern.test(`${call.method} ${url}`));
    if (!match)
      return json({ error: { message: `no route for ${call.method} ${url}`, code: 1 } }, 400);
    const result = await match[1](call);
    return result instanceof Response ? result : json(result);
  });

  const one = await createWorkspace(`Social Co ${stamp}`, mail('social-owner'));
  tenantId = one.tenantId;
  users.push(one.ownerId);
  const two = await createWorkspace(`Social Other ${stamp}`, mail('social-other'));
  otherTenant = two.tenantId;
  otherUsers.push(two.ownerId);
  const managerId = await addMember(tenantId, mail('social-manager'), 'Morgan Manager', 'manager');
  const staffId = await addMember(tenantId, mail('social-staff'), 'Sky Staff', 'member');
  users.push(managerId, staffId);
  owner = await contextFor(one.ownerId, tenantId);
  manager = await contextFor(managerId, tenantId);
  staff = await contextFor(staffId, tenantId);
  outsider = await contextFor(two.ownerId, otherTenant);
});

afterEach(() => {
  routes = [];
});

afterAll(async () => {
  vi.restoreAllMocks();
  for (const name of [
    'META_APP_ID',
    'META_APP_SECRET',
    'META_LOGIN_CONFIG_ID',
    'META_WEBHOOK_VERIFY_TOKEN',
    'TIKTOK_APP_ID',
    'TIKTOK_APP_SECRET',
    'TIKTOK_AUTH_URL',
  ]) {
    delete process.env[name];
  }
  await destroyWorkspace(tenantId, users);
  await destroyWorkspace(otherTenant, otherUsers);
});

/* ---------------------------------------------------------------------------- helpers */

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

const rows = async <T>(query: ReturnType<typeof sql>) =>
  (await adminDb().execute(query)) as unknown as T[];

async function account(platform: string, tenant = tenantId) {
  const [row] = await rows<{ id: string; status: string; disconnected_at: string | null }>(sql`
    select id, status, disconnected_at from social_accounts
    where tenant_id = ${tenant} and platform = ${platform} order by connected_at desc limit 1`);
  return row;
}

async function conversationWith(participant: string) {
  const [row] = await rows<{
    id: string;
    unread_count: number;
    status: string;
    contact_id: string | null;
  }>(sql`
    select id, unread_count, status, contact_id from social_conversations
    where tenant_id = ${tenantId} and participant_id = ${participant}`);
  return row!;
}

function signedMetaRequest(body: unknown, secret = process.env.META_APP_SECRET!) {
  const raw = JSON.stringify(body);
  return new Request('http://localhost:3000/api/webhooks/meta', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`,
    },
    body: raw,
  });
}

const pageMessage = (participant: string, mid: string, text: string, echo = false) => ({
  object: 'page',
  entry: [
    {
      id: PAGE,
      time: Date.now(),
      messaging: [
        {
          sender: { id: echo ? PAGE : participant },
          recipient: { id: echo ? participant : PAGE },
          timestamp: Date.now(),
          message: { mid, text, ...(echo ? { is_echo: true } : {}) },
        },
      ],
    },
  ],
});

/* ------------------------------------------------------------------------------ tests */

describe('connecting Facebook and Instagram', () => {
  it('saves each account with its token sealed, imports recent conversations and audits it', async () => {
    metaHappyPath();
    const result = await connectAccounts(owner, 'meta', 'CODE-1', REDIRECT);
    expect(result).toEqual({ connected: 2, skipped: 0, failed: 0 });

    const accounts = await rows<{ platform: string; status: string }>(sql`
      select platform, status from social_accounts where tenant_id = ${tenantId} order by platform`);
    expect(accounts).toEqual([
      { platform: 'facebook', status: 'active' },
      { platform: 'instagram', status: 'active' },
    ]);
    const sealed = await rows<{ access_token_ciphertext: string }>(sql`
      select access_token_ciphertext from social_account_credentials where tenant_id = ${tenantId}`);
    expect(sealed).toHaveLength(2);
    for (const row of sealed) expect(row.access_token_ciphertext).not.toMatch(/TOKEN/);

    const page = await account('facebook');
    const opened = await withRls(owner, (tx) => readCredentials(tx, tenantId, page!.id));
    expect(opened?.accessToken).toBe('PAGE_TOKEN');

    const imported = await conversationWith('PSID1');
    expect(imported.unread_count).toBe(0);
    const thread = await getConversation(owner, imported.id);
    expect(thread?.conversation.participantName).toBe('Jamie Customer');
    expect(thread?.messages.map((message) => [message.direction, message.body])).toEqual([
      ['inbound', 'Gluten free options?'],
      ['outbound', 'Yes, we do!'],
    ]);

    const audited = await rows<{ n: number }>(sql`
      select count(*)::int as n from audit_logs
      where tenant_id = ${tenantId} and entity_type = 'social_account' and action = 'create'`);
    expect(audited[0]?.n).toBe(2);
    // Tokens travel in headers or bodies, never in an address that could be logged.
    for (const call of calls) {
      expect(call.url).not.toMatch(/SYSTEM_USER_TOKEN|PAGE_TOKEN|meta-secret/);
    }
  });

  it('leaves an account alone when another business already has it live', async () => {
    metaHappyPath();
    const result = await connectAccounts(outsider, 'meta', 'CODE-2', REDIRECT);
    expect(result).toEqual({ connected: 0, skipped: 2, failed: 0 });
    expect(await account('facebook', otherTenant)).toBeUndefined();
  });

  it('is refused to a manager, who can read and reply but not connect', async () => {
    await expectCode(() => connectAccounts(manager, 'meta', 'CODE-3', REDIRECT), 'FORBIDDEN');
  });
});

describe('who can read', () => {
  it('no session reads the tokens table; only the permission-checked function opens it', async () => {
    expect(
      await sqlState(() =>
        withRls(owner, (tx) => tx.execute(sql`select * from social_account_credentials`)),
      ),
    ).toBe('42501');
    const page = await account('facebook');
    const viaFunction = async (ctx: TenantContext) =>
      (
        (await withRls(ctx, (tx) =>
          tx.execute(sql`select * from app.social_read_credentials(${page!.id}::uuid)`),
        )) as unknown as unknown[]
      ).length;
    expect(await viaFunction(owner)).toBe(1);
    expect(await viaFunction(staff)).toBe(0);
    expect(await viaFunction(outsider)).toBe(0);
  });

  it('staff without the inbox see nothing, in the app or in the database', async () => {
    await expectCode(() => listConversations(staff, {}), 'FORBIDDEN');
    const visible = (await withRls(staff, (tx) =>
      tx.execute(sql`select count(*)::int as n from social_messages where tenant_id = ${tenantId}`),
    )) as unknown as { n: number }[];
    expect(visible[0]?.n).toBe(0);
  });

  it('another business sees none of it, even by id', async () => {
    const imported = await conversationWith('PSID1');
    expect(await getConversation(outsider, imported.id)).toBeNull();
    const visible = (await withRls(outsider, (tx) =>
      tx.execute(
        sql`select count(*)::int as n from social_conversations where tenant_id = ${tenantId}`,
      ),
    )) as unknown as { n: number }[];
    expect(visible[0]?.n).toBe(0);
  });

  it('nothing is reachable while the feature is switched off for the business', async () => {
    await adminDb().execute(
      sql`update tenants set features = array_remove(features, 'social') where id = ${tenantId}`,
    );
    try {
      const switchedOff = await contextFor(owner.userId, tenantId);
      await expectCode(() => listConversations(switchedOff, {}), 'FORBIDDEN');
      const visible = (await withRls(switchedOff, (tx) =>
        tx.execute(sql`select count(*)::int as n from social_conversations`),
      )) as unknown as { n: number }[];
      expect(visible[0]?.n).toBe(0);
    } finally {
      await adminDb().execute(
        sql`update tenants set features = array_append(features, 'social') where id = ${tenantId}`,
      );
    }
  });
});

describe('Meta webhooks', () => {
  it('answers Meta’s address check only with the right verify token', async () => {
    const ask = (token: string) =>
      metaVerify(
        new Request(
          `http://localhost:3000/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=12345`,
        ),
      );
    const good = await ask(process.env.META_WEBHOOK_VERIFY_TOKEN!);
    expect(good.status).toBe(200);
    expect(await good.text()).toBe('12345');
    expect((await ask('wrong-token-0123456789')).status).toBe(403);
  });

  it('stores a signed message once, counts it unread and reopens the conversation', async () => {
    const before = await conversationWith('PSID1');
    await adminDb().execute(
      sql`update social_conversations set status = 'done' where id = ${before.id}`,
    );
    const body = pageMessage('PSID1', `m_new_${stamp}`, 'Are you open Sunday?');
    expect((await metaWebhook(signedMetaRequest(body))).status).toBe(200);
    expect((await metaWebhook(signedMetaRequest(body))).status).toBe(200);
    const after = await conversationWith('PSID1');
    expect(after).toMatchObject({ unread_count: 1, status: 'open' });
    const stored = await rows<{ n: number }>(sql`
      select count(*)::int as n from social_messages where external_id = ${`m_new_${stamp}`}`);
    expect(stored[0]?.n).toBe(1);
  });

  it('refuses an unsigned or wrongly signed body and stores nothing', async () => {
    const body = pageMessage('PSID1', `m_forged_${stamp}`, 'forged');
    expect((await metaWebhook(signedMetaRequest(body, 'not-the-app-secret-0000'))).status).toBe(
      403,
    );
    const unsigned = new Request('http://localhost:3000/api/webhooks/meta', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    expect((await metaWebhook(unsigned)).status).toBe(403);
    const stored = await rows<{ n: number }>(sql`
      select count(*)::int as n from social_messages where external_id = ${`m_forged_${stamp}`}`);
    expect(stored[0]?.n).toBe(0);
  });

  it('starts a conversation for a new customer and names them', async () => {
    metaHappyPath();
    const body = pageMessage('PSID2', `m_first_${stamp}`, 'Hi there');
    expect((await metaWebhook(signedMetaRequest(body))).status).toBe(200);
    const created = await conversationWith('PSID2');
    const thread = await getConversation(owner, created.id);
    expect(thread?.conversation.participantName).toBe('Alex New');
    expect(created.unread_count).toBe(1);
  });
});

describe('replying', () => {
  it('sends within the window and stores the reply once, even when Meta’s echo comes first', async () => {
    const conversation = await conversationWith('PSID1');
    route('POST', new RegExp(`.*/${PAGE}/messages`), async () => {
      // The echo arrives while the send call is still waiting for Meta's answer.
      const echo = pageMessage('PSID1', `m_reply_${stamp}`, 'Yes, 9 to 5', true);
      expect((await metaWebhook(signedMetaRequest(echo))).status).toBe(200);
      return { recipient_id: 'PSID1', message_id: `m_reply_${stamp}` };
    });
    await replyToConversation(manager, { conversationId: conversation.id, body: 'Yes, 9 to 5' });
    const sent = await rows<{ external_id: string; status: string; sent_by_user_id: string }>(sql`
      select external_id, status, sent_by_user_id from social_messages
      where conversation_id = ${conversation.id} and body = 'Yes, 9 to 5'`);
    expect(sent).toEqual([
      { external_id: `m_reply_${stamp}`, status: 'sent', sent_by_user_id: manager.userId },
    ]);
    const payload = JSON.parse(calls.at(-1)!.body) as Record<string, unknown>;
    expect(payload).toMatchObject({ recipient: { id: 'PSID1' }, messaging_type: 'RESPONSE' });
  });

  it('uses the human agent tag after 24 hours and refuses after 7 days, saying why', async () => {
    const conversation = await conversationWith('PSID1');
    route('POST', new RegExp(`.*/${PAGE}/messages`), () => ({ message_id: `m_late_${stamp}` }));
    await adminDb().execute(sql`
      update social_conversations set last_inbound_at = now() - interval '2 days' where id = ${conversation.id}`);
    await replyToConversation(manager, {
      conversationId: conversation.id,
      body: 'Sorry for the wait',
    });
    expect(JSON.parse(calls.at(-1)!.body)).toMatchObject({
      messaging_type: 'MESSAGE_TAG',
      tag: 'HUMAN_AGENT',
    });

    await adminDb().execute(sql`
      update social_conversations set last_inbound_at = now() - interval '8 days' where id = ${conversation.id}`);
    await expectCode(
      () => replyToConversation(manager, { conversationId: conversation.id, body: 'Too late' }),
      'WINDOW_EXPIRED',
    );
    await adminDb().execute(sql`
      update social_conversations set last_inbound_at = now() where id = ${conversation.id}`);
  });

  it('keeps a refused reply as failed with Meta’s reason, and flags a dead token for reconnecting', async () => {
    const conversation = await conversationWith('PSID1');
    route('POST', new RegExp(`.*/${PAGE}/messages`), () =>
      json({ error: { message: '(#100) The recipient is not available', code: 100 } }, 400),
    );
    await expectCode(
      () => replyToConversation(manager, { conversationId: conversation.id, body: 'Hello?' }),
      'CONFLICT',
    );
    const [failed] = await rows<{ status: string; error: string }>(sql`
      select status, error from social_messages where conversation_id = ${conversation.id} and body = 'Hello?'`);
    expect(failed).toEqual({ status: 'failed', error: '(#100) The recipient is not available' });

    route('POST', new RegExp(`.*/${PAGE}/messages`), () =>
      json({ error: { message: 'Error validating access token', code: 190 } }, 400),
    );
    await expectCode(
      () => replyToConversation(manager, { conversationId: conversation.id, body: 'Again' }),
      'CONFLICT',
    );
    expect((await account('facebook'))?.status).toBe('needs_reconnect');
    await adminDb().execute(
      sql`update social_accounts set status = 'active' where tenant_id = ${tenantId}`,
    );
  });

  it('is refused to staff without social.reply', async () => {
    const conversation = await conversationWith('PSID1');
    await expectCode(
      () => replyToConversation(staff, { conversationId: conversation.id, body: 'Hi' }),
      'FORBIDDEN',
    );
  });
});

describe('linking a contact', () => {
  it('links only a contact the person may see, and audits the change', async () => {
    const conversation = await conversationWith('PSID1');
    const ownersContact = await createContact(
      owner,
      createContactSchema.parse({
        firstName: 'Jamie',
        lastName: 'Owner-only',
        confirmDuplicate: true,
      }),
    );
    // A manager sees their team's contacts; the owner's own contact is outside that.
    await expectCode(
      () =>
        linkConversationContact(manager, {
          conversationId: conversation.id,
          contactId: ownersContact.id,
        }),
      'NOT_FOUND',
    );
    const managersContact = await createContact(
      manager,
      createContactSchema.parse({
        firstName: 'Jamie',
        lastName: 'Customer',
        confirmDuplicate: true,
      }),
    );
    await linkConversationContact(manager, {
      conversationId: conversation.id,
      contactId: managersContact.id,
    });
    expect((await conversationWith('PSID1')).contact_id).toBe(managersContact.id);
    const listed = await listConversations(manager, { view: 'all' });
    expect(listed.rows.find((row) => row.id === conversation.id)?.contactName).toBe(
      'Jamie Customer',
    );
    const audited = await rows<{ n: number }>(sql`
      select count(*)::int as n from audit_logs
      where tenant_id = ${tenantId} and entity_type = 'social_conversation' and entity_id = ${conversation.id}`);
    expect(audited[0]?.n).toBeGreaterThan(0);
  });
});

describe('disconnecting', () => {
  it('forgets the token and stops new messages, keeping the history; reconnecting continues it', async () => {
    metaHappyPath();
    const page = await account('facebook');
    await disconnectAccount(owner, page!.id);
    expect((await account('facebook'))?.disconnected_at).not.toBeNull();
    const tokens = await rows<{ n: number }>(sql`
      select count(*)::int as n from social_account_credentials where account_id = ${page!.id}`);
    expect(tokens[0]?.n).toBe(0);

    const late = pageMessage('PSID1', `m_after_${stamp}`, 'Still there?');
    expect((await metaWebhook(signedMetaRequest(late))).status).toBe(200);
    const stored = await rows<{ n: number }>(sql`
      select count(*)::int as n from social_messages where external_id = ${`m_after_${stamp}`}`);
    expect(stored[0]?.n).toBe(0);
    expect(await getConversation(owner, (await conversationWith('PSID1')).id)).not.toBeNull();

    await connectAccounts(owner, 'meta', 'CODE-4', REDIRECT);
    const again = await account('facebook');
    expect(again?.id).toBe(page!.id);
    expect(again?.disconnected_at).toBeNull();
  });
});

describe('TikTok', () => {
  function tiktokRoutes(messages: unknown[]) {
    route('POST', /.*\/tt_user\/oauth2\/token\//, () => ({
      code: 0,
      data: {
        open_id: TT,
        access_token: 'TT_ACCESS',
        expires_in: 86_400,
        refresh_token: 'TT_REFRESH',
        refresh_token_expires_in: 31_536_000,
      },
    }));
    route('GET', /.*\/business\/get\//, () => ({
      code: 0,
      data: { username: 'harbourcafe', display_name: 'Harbour Cafe' },
    }));
    route('GET', /.*\/business\/message\/conversation\/list\/.*SINGLE/, () => ({
      code: 0,
      data: { conversations: [{ conversation_id: 'conv+1==', update_time: Date.now() }] },
    }));
    route('GET', /.*\/business\/message\/conversation\/list\/.*STRANGER/, () => ({
      code: 0,
      data: { conversations: [] },
    }));
    route('GET', /.*\/business\/message\/content\/list\//, () => ({ code: 0, data: { messages } }));
    route('POST', /.*\/tt_user\/oauth2\/refresh_token\//, () => ({
      code: 0,
      data: { access_token: 'TT_ACCESS_2', expires_in: 86_400, refresh_token: 'TT_REFRESH_2' },
    }));
  }
  const first = {
    sender: 'kim.k',
    message_id: 'tt_m1',
    timestamp: Date.now() - 60_000,
    message_type: 'TEXT',
    text: { body: 'Do you deliver?' },
  };

  it('connects an account with its day-long token and imports its conversations', async () => {
    tiktokRoutes([first]);
    expect(
      await connectAccounts(
        owner,
        'tiktok',
        'TT-CODE',
        'http://localhost:3000/api/social/oauth/tiktok',
      ),
    ).toEqual({
      connected: 1,
      skipped: 0,
      failed: 0,
    });
    const conversation = await conversationWith('conv+1==');
    const thread = await getConversation(owner, conversation.id);
    expect(thread?.conversation.participantUsername).toBe('kim.k');
    expect(thread?.messages.map((message) => message.body)).toEqual(['Do you deliver?']);
  });

  it('treats a notification only as a reason to read the conversation again through the API', async () => {
    const second = {
      sender: 'kim.k',
      message_id: 'tt_m2',
      timestamp: Date.now(),
      message_type: 'TEXT',
      text: { body: 'Hello?' },
    };
    tiktokRoutes([first, second]);
    // The day-long token has run out: it is renewed before reading, and the new one stored.
    await adminDb().execute(sql`
      update social_account_credentials set access_expires_at = now() - interval '1 hour'
      where tenant_id = ${tenantId} and account_id = (select id from social_accounts where tenant_id = ${tenantId} and platform = 'tiktok')`);
    const notify = (clientKey: string) =>
      tiktokWebhook(
        new Request('http://localhost:3000/api/webhooks/tiktok', {
          method: 'POST',
          body: JSON.stringify({
            client_key: clientKey,
            event: 'im_receive_msg',
            create_time: 1,
            user_openid: TT,
            // Content the notification claims is never stored: only TikTok's API answer is.
            content: JSON.stringify({ conversation_id: 'conv+1==', text: { body: 'PLANTED' } }),
          }),
        }),
      );
    const before = calls.length;
    expect((await notify('someone-else')).status).toBe(200);
    expect(calls.length).toBe(before);

    expect((await notify('tiktok-app-1')).status).toBe(200);
    expect(calls.some((call) => call.url.includes('/tt_user/oauth2/refresh_token/'))).toBe(true);
    const conversation = await conversationWith('conv+1==');
    const thread = await getConversation(owner, conversation.id);
    expect(thread?.messages.map((message) => message.body)).toEqual(['Do you deliver?', 'Hello?']);
    expect(conversation.unread_count).toBe(1);
    const tt = await account('tiktok');
    const renewed = await withRls(owner, (tx) => readCredentials(tx, tenantId, tt!.id));
    expect(renewed?.accessToken).toBe('TT_ACCESS_2');
  });
});
