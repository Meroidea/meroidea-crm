import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GET as pollRoute, POST as postRoute } from '@/app/api/chat/[key]/messages/route';
import { POST as sessionRoute } from '@/app/api/chat/[key]/session/route';
import { AppError } from '@/lib/errors';
import { anonymizeContact } from '@/modules/contacts/privacy';
import { chatFramePolicy } from '@/modules/social/livechat-frame';
import {
  identitySignature,
  listVisitorMessages,
  postVisitorMessage,
  startChatSession,
} from '@/modules/social/livechat-public';
import {
  createChatWidget,
  rotateChatIdentitySecret,
  updateChatWidget,
} from '@/modules/social/livechat-service';
import { listAccounts } from '@/modules/social/queries';
import { disconnectAccount, replyToConversation } from '@/modules/social/service';
import { addNote, setAccountSettings } from '@/modules/social/team-service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

// Live chat (ADR-072): the widget's public routes, the visitor's token and identity, and how
// the inbox, contacts and row-level security treat a chat. Everything is real; nothing is mocked.

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;
const KNOWN = `pat-${stamp}@example.com`;
const SITE = 'https://www.example.com';

let tenantId: string;
let otherTenant: string;
const users: string[] = [];
const otherUsers: string[] = [];
let owner: TenantContext;
let manager: TenantContext;
let outsider: TenantContext;
let knownContactId: string;
let widget: { id: string; key: string; identitySecret: string };
let otherWidget: { id: string; key: string; identitySecret: string };

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

const uuid = () => crypto.randomUUID();
const address = () => `203.0.113.${Math.floor(Math.random() * 250) + 1}`;

beforeAll(async () => {
  const one = await createWorkspace(`Chat Co ${stamp}`, mail('lc-owner'));
  tenantId = one.tenantId;
  users.push(one.ownerId);
  const two = await createWorkspace(`Chat Other ${stamp}`, mail('lc-other'));
  otherTenant = two.tenantId;
  otherUsers.push(two.ownerId);
  const managerId = await addMember(tenantId, mail('lc-manager'), 'Mel Manager', 'manager');
  users.push(managerId);
  owner = await contextFor(one.ownerId, tenantId);
  manager = await contextFor(managerId, tenantId);
  outsider = await contextFor(two.ownerId, otherTenant);
  const [contact] = await rows<{ id: string }>(sql`
    insert into contacts (tenant_id, first_name, email, email_normalized)
    values (${tenantId}, 'Pat', ${KNOWN}, ${KNOWN}) returning id`);
  knownContactId = contact!.id;
  widget = await createChatWidget(owner, {
    name: 'Chat Co help',
    allowedOrigins: [SITE],
    greeting: 'Hi there',
    requireEmail: false,
  });
  otherWidget = await createChatWidget(outsider, {
    name: 'Other help',
    allowedOrigins: [],
    greeting: null,
    requireEmail: false,
  });
});

afterAll(async () => {
  await destroyWorkspace(tenantId, users);
  await destroyWorkspace(otherTenant, otherUsers);
});

describe('setting up a widget', () => {
  it('needs social.manage', async () => {
    await expectCode(
      () =>
        createChatWidget(manager, {
          name: 'Nope',
          allowedOrigins: [],
          greeting: null,
          requireEmail: false,
        }),
      'FORBIDDEN',
    );
  });

  it('keeps the identity secret sealed, never in plain text', async () => {
    expect(widget.key).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const [stored] = await rows<{ access_token_ciphertext: string }>(sql`
      select access_token_ciphertext from social_account_credentials where account_id = ${widget.id}`);
    expect(stored!.access_token_ciphertext).not.toContain(widget.identitySecret);
  });

  it('lists the widget key for the embed code, and only for live chat', async () => {
    const { accounts } = await listAccounts(owner);
    const row = accounts.find((account) => account.id === widget.id);
    expect(row?.widgetKey).toBe(widget.key);
    expect(row?.settings.allowedOrigins).toEqual([SITE]);
  });

  it('refuses a site that is not an https origin', async () => {
    await expect(
      withRls(owner, (tx) =>
        tx.execute(
          sql`select app.social_set_account_settings(${widget.id}::uuid, ${JSON.stringify({
            allowedOrigins: ['javascript:alert(1)'],
          })}::jsonb)`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('changing the lead setting keeps the widget’s sites and greeting', async () => {
    await setAccountSettings(owner, {
      accountId: widget.id,
      createLeadForUnknown: true,
      leadSourceId: null,
    });
    const { accounts } = await listAccounts(owner);
    const row = accounts.find((account) => account.id === widget.id)!;
    expect(row.settings.allowedOrigins).toEqual([SITE]);
    expect(row.settings.greeting).toBe('Hi there');
    expect(row.settings.createLeadForUnknown).toBe(true);
  });

  it('only listed sites may frame the widget', async () => {
    expect(await chatFramePolicy(widget.key)).toContain(`frame-ancestors ${SITE};`);
    expect(await chatFramePolicy(otherWidget.key)).toContain("frame-ancestors 'none'");
    expect(await chatFramePolicy('not-a-widget-key-at-all!')).toContain("frame-ancestors 'none'");
  });
});

describe('a visitor chatting', () => {
  let token: string;
  let conversationId: string;

  it('starts a chat and gets a token; only its hash is stored', async () => {
    const started = await startChatSession(widget.key, { name: 'Sam' }, address());
    token = started.token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(started.visitor).toEqual({ name: 'Sam', email: null, verified: false });
    const stored = await rows<{ token_hash: string }>(
      sql`select token_hash from livechat_visitors where account_id = ${widget.id}`,
    );
    expect(stored.some((row) => row.token_hash === token)).toBe(false);
  });

  it('stores a message once however often it is retried, in a new conversation', async () => {
    const clientId = uuid();
    const first = await postVisitorMessage(widget.key, { token, clientId, body: 'Hello' }, null);
    const again = await postVisitorMessage(widget.key, { token, clientId, body: 'Hello' }, null);
    expect(again.message.id).toBe(first.message.id);
    const [conversation] = await rows<{
      id: string;
      participant_name: string;
      unread_count: number;
      contact_id: string | null;
    }>(sql`select c.id, c.participant_name, c.unread_count, c.contact_id
           from social_conversations c where c.account_id = ${widget.id}`);
    conversationId = conversation!.id;
    expect(conversation!.participant_name).toBe('Sam');
    expect(conversation!.unread_count).toBe(1);
    // No email given: like a website form without one, no lead is made.
    expect(conversation!.contact_id).toBeNull();
  });

  it('sees the business’s replies but never a private note', async () => {
    await replyToConversation(owner, { conversationId, body: 'How can we help?' });
    await addNote(owner, { conversationId, body: 'Secret colleague note' });
    const { messages, cursor } = await listVisitorMessages(widget.key, { token });
    expect(messages.map((message) => [message.from, message.body])).toEqual([
      ['visitor', 'Hello'],
      ['business', 'How can we help?'],
    ]);
    // Polling again from the cursor only repeats recent messages, which the widget drops.
    const later = await listVisitorMessages(widget.key, { token, after: cursor! });
    expect(later.messages.every((message) => messages.some((seen) => seen.id === message.id))).toBe(
      true,
    );
  });

  it('a token works only on its own widget (cross-tenant)', async () => {
    await expectCode(() => listVisitorMessages(otherWidget.key, { token }), 'NOT_FOUND');
    await expectCode(
      () => postVisitorMessage(otherWidget.key, { token, clientId: uuid(), body: 'Hi' }, null),
      'NOT_FOUND',
    );
  });

  it('another visitor cannot read this chat (cross-visitor)', async () => {
    const stranger = await startChatSession(widget.key, {}, address());
    const { messages } = await listVisitorMessages(widget.key, { token: stranger.token });
    expect(messages).toEqual([]);
  });

  it('a name and email cannot be changed once the chat has begun', async () => {
    const resumed = await startChatSession(
      widget.key,
      { token, name: 'Mallory', email: KNOWN },
      address(),
    );
    expect(resumed.token).toBe(token);
    expect(resumed.visitor).toEqual({ name: 'Sam', email: null, verified: false });
  });
});

describe('who the visitor is', () => {
  it('a self-given email that matches a contact is only suggested, never linked', async () => {
    const { token } = await startChatSession(widget.key, { email: KNOWN }, address());
    await postVisitorMessage(widget.key, { token, clientId: uuid(), body: 'It is Pat' }, null);
    const [row] = await rows<{ contact_id: string | null; contact_match: string | null }>(sql`
      select c.contact_id, c.contact_match from social_conversations c
      join livechat_visitors v on v.conversation_id = c.id
      where v.account_id = ${widget.id} and v.email = ${KNOWN} and not v.email_verified`);
    expect(row).toEqual({ contact_id: null, contact_match: 'suggested' });
  });

  it('an email the business’s site signed links the contact', async () => {
    const signature = identitySignature(widget.identitySecret, KNOWN);
    const { token, visitor } = await startChatSession(
      widget.key,
      { identity: { email: KNOWN, name: 'Pat', signature } },
      address(),
    );
    expect(visitor).toEqual({ name: 'Pat', email: KNOWN, verified: true });
    await postVisitorMessage(widget.key, { token, clientId: uuid(), body: 'Signed in' }, null);
    const [row] = await rows<{ contact_id: string | null; contact_match: string | null }>(sql`
      select c.contact_id, c.contact_match from social_conversations c
      join livechat_visitors v on v.conversation_id = c.id
      where v.account_id = ${widget.id} and v.email_verified`);
    expect(row).toEqual({ contact_id: knownContactId, contact_match: 'auto' });
  });

  it('a wrong signature is ignored: the visitor carries on unverified', async () => {
    const forged = identitySignature('not-the-secret', KNOWN);
    const { visitor } = await startChatSession(
      widget.key,
      { identity: { email: KNOWN, signature: forged } },
      address(),
    );
    expect(visitor.verified).toBe(false);
    expect(visitor.email).toBeNull();
  });

  it('a new identity secret stops the old one working', async () => {
    const old = widget.identitySecret;
    const { identitySecret } = await rotateChatIdentitySecret(owner, widget.id);
    const stale = await startChatSession(
      widget.key,
      { identity: { email: KNOWN, signature: identitySignature(old, KNOWN) } },
      address(),
    );
    expect(stale.visitor.verified).toBe(false);
    const fresh = await startChatSession(
      widget.key,
      { identity: { email: KNOWN, signature: identitySignature(identitySecret, KNOWN) } },
      address(),
    );
    expect(fresh.visitor.verified).toBe(true);
    widget.identitySecret = identitySecret;
  });

  it('a signed-in visitor’s token is not reused by someone else signing in on that browser', async () => {
    const pat = await startChatSession(
      widget.key,
      {
        identity: {
          email: KNOWN,
          signature: identitySignature(widget.identitySecret, KNOWN),
        },
      },
      address(),
    );
    const otherEmail = mail('someone-else');
    const next = await startChatSession(
      widget.key,
      {
        token: pat.token,
        identity: {
          email: otherEmail,
          signature: identitySignature(widget.identitySecret, otherEmail),
        },
      },
      address(),
    );
    expect(next.token).not.toBe(pat.token);
    expect(next.visitor.email).toBe(otherEmail);
  });

  it('an email is asked for first when the widget requires one', async () => {
    await updateChatWidget(owner, {
      accountId: widget.id,
      name: 'Chat Co help',
      allowedOrigins: [SITE],
      greeting: 'Hi there',
      requireEmail: true,
    });
    const { token } = await startChatSession(widget.key, {}, address());
    await expectCode(
      () => postVisitorMessage(widget.key, { token, clientId: uuid(), body: 'Hi' }, null),
      'VALIDATION',
    );
    await startChatSession(widget.key, { token, email: mail('asked') }, address());
    await postVisitorMessage(widget.key, { token, clientId: uuid(), body: 'Hi' }, null);
    await updateChatWidget(owner, {
      accountId: widget.id,
      name: 'Chat Co help',
      allowedOrigins: [SITE],
      greeting: 'Hi there',
      requireEmail: false,
    });
  });

  it('a visitor who left an email becomes a lead when the widget is set to', async () => {
    const email = mail('new-lead');
    const { token } = await startChatSession(widget.key, { name: 'Lou Lead', email }, address());
    await postVisitorMessage(widget.key, { token, clientId: uuid(), body: 'Prices?' }, null);
    const [contact] = await rows<{ first_name: string; email: string }>(sql`
      select first_name, email from contacts where tenant_id = ${tenantId} and email = ${email}`);
    expect(contact).toEqual({ first_name: 'Lou', email });
  });
});

describe('row-level security and switches', () => {
  it('staff of another business cannot read visitors', async () => {
    const seen = await withRls(outsider, (tx) =>
      tx.execute(sql`select id from livechat_visitors where tenant_id = ${tenantId}`),
    );
    expect(seen).toHaveLength(0);
  });

  it('the inbox shows visitors to people who can see it, not to others', async () => {
    const seen = (await withRls(manager, (tx) =>
      tx.execute(sql`select id from livechat_visitors where tenant_id = ${tenantId}`),
    )) as unknown[];
    expect(seen.length).toBeGreaterThan(0);
    // Visitors are written only by the public routes, never by a session.
    await expect(
      withRls(manager, (tx) =>
        tx.execute(sql`update livechat_visitors set email_verified = true
                       where tenant_id = ${tenantId}`),
      ),
    ).rejects.toThrow();
  });

  it('with live chat switched off the widget is unavailable', async () => {
    await adminDb().execute(
      sql`update tenants set features = array_remove(features, 'live_chat') where id = ${tenantId}`,
    );
    try {
      await expectCode(() => startChatSession(widget.key, {}, address()), 'NOT_FOUND');
      const seen = (await withRls(owner, (tx) =>
        tx.execute(sql`select id from livechat_visitors where tenant_id = ${tenantId}`),
      )) as unknown[];
      expect(seen).toHaveLength(0);
    } finally {
      await adminDb().execute(
        sql`update tenants set features = features || array['live_chat'] where id = ${tenantId}`,
      );
    }
  });

  it('erasing a contact clears the name and email a visitor gave', async () => {
    await anonymizeContact(owner, knownContactId);
    const left = await rows<{ email: string | null }>(sql`
      select email from livechat_visitors where tenant_id = ${tenantId} and email = ${KNOWN}`);
    expect(left).toHaveLength(0);
  });
});

describe('the public routes', () => {
  const request = (url: string, init: RequestInit = {}) =>
    new Request(`http://localhost:3000${url}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
  const context = <T extends string>(key: T) => ({ params: Promise.resolve({ key }) });

  it('start, send and poll without a session, the token in a header', async () => {
    const started = await sessionRoute(
      request(`/api/chat/${widget.key}/session`, {
        method: 'POST',
        body: JSON.stringify({ name: 'Route Visitor' }),
      }),
      context(widget.key),
    );
    expect(started.status).toBe(200);
    expect(started.headers.get('cache-control')).toBe('no-store');
    const { data } = (await started.json()) as { data: { token: string } };
    const sent = await postRoute(
      request(`/api/chat/${widget.key}/messages`, {
        method: 'POST',
        body: JSON.stringify({ token: data.token, clientId: uuid(), body: 'From the route' }),
      }),
      context(widget.key),
    );
    expect(sent.status).toBe(200);
    const { NextRequest } = await import('next/server');
    const polled = await pollRoute(
      new NextRequest(`http://localhost:3000/api/chat/${widget.key}/messages`, {
        headers: { 'x-chat-token': data.token },
      }),
      context(widget.key),
    );
    const body = (await polled.json()) as { data: { messages: { body: string }[] } };
    expect(body.data.messages.map((message) => message.body)).toEqual(['From the route']);
  });

  it('an unknown widget or a missing token is refused', async () => {
    const unknown = await sessionRoute(
      request('/api/chat/AAAAAAAAAAAAAAAAAAAAAAAA/session', { method: 'POST', body: '{}' }),
      context('AAAAAAAAAAAAAAAAAAAAAAAA'),
    );
    expect(unknown.status).toBe(404);
    const { NextRequest } = await import('next/server');
    const tokenless = await pollRoute(
      new NextRequest(`http://localhost:3000/api/chat/${widget.key}/messages`),
      context(widget.key),
    );
    expect(tokenless.status).toBe(400);
  });

  it('a disconnected widget stops answering, without calling any provider', async () => {
    await disconnectAccount(owner, widget.id);
    await expectCode(() => startChatSession(widget.key, {}, address()), 'NOT_FOUND');
    const credentials = await rows(sql`
      select 1 from social_account_credentials where account_id = ${widget.id}`);
    expect(credentials).toHaveLength(0);
  });
});
