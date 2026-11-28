import { createHmac } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { POST as resendWebhook } from '@/app/api/webhooks/resend/route';
import { AppError } from '@/lib/errors';
import { anonymizeContact } from '@/modules/contacts/privacy';
import { textToEmailDoc, type EmailDoc } from '@/modules/social/email-doc';
import { createEmailInbox } from '@/modules/social/email-service';
import { getConversation, listAccounts, listConversations } from '@/modules/social/queries';
import {
  replyToConversation,
  retryReply,
  startComposeUpload,
  startEmailConversation,
} from '@/modules/social/service';
import { setAccountSettings } from '@/modules/social/team-service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';
import { createSupabaseAdminClient } from '@/server/supabase/admin';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

// Email inbox (ADR-070). Resend is simulated at the network edge only; the database, row-level
// security, the signed webhook route and the services are the real ones.

const SECRET = 'whsec_' + Buffer.from('a-test-signing-secret-of-enough-length').toString('base64');
vi.hoisted(() => {
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.INBOX_EMAIL_DOMAIN = 'inbox.example.com';
  process.env.RESEND_WEBHOOK_SECRET =
    'whsec_' + Buffer.from('a-test-signing-secret-of-enough-length').toString('base64');
});

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;
const DOMAIN = 'inbox.example.com';
const LOCAL = `harbour-${stamp}`;
const INBOX = `${LOCAL}@${DOMAIN}`;
const KNOWN = `kim-${stamp}@example.com`;
const STRANGER = `lee-${stamp}@example.com`;
const RECIPIENT_COMPOSE = `kim-${stamp}@example.com`;

let tenantId: string;
let otherTenant: string;
let accountId: string;
const users: string[] = [];
const otherUsers: string[] = [];
let owner: TenantContext;
let manager: TenantContext;
let outsider: TenantContext;
let knownContactId: string;

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

/* --------------------------------------------------------------- simulated Resend */

type Received = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  messageId: string;
  headers?: Record<string, string>;
  dkim?: 'pass' | 'fail' | 'gray';
};
const received = new Map<string, Received>();
const sends: { body: Record<string, unknown>; idempotency: string | null }[] = [];
/** The next send is refused by the simulated Resend, as a real refusal would be. */
let refuseNextSend = false;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://api.resend.com/')) return realFetch(input, init);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    const receiving = /\/emails\/receiving\/([^/?]+)(\/attachments)?/.exec(url);
    if (receiving) {
      const email = received.get(receiving[1]!);
      if (!email) return json({ message: 'not found' }, 404);
      if (receiving[2]) return json({ object: 'list', has_more: false, data: [] });
      return json({
        object: 'email',
        id: receiving[1],
        from: email.from,
        to: email.to,
        cc: [],
        subject: email.subject,
        text: email.text,
        html: null,
        message_id: email.messageId,
        created_at: new Date().toISOString(),
        headers: { from: email.from, ...(email.headers ?? {}) },
        authentication: { spf: 'pass', dkim: email.dkim ?? 'pass', dmarc: 'gray' },
      });
    }
    if (url === 'https://api.resend.com/emails' && init?.method === 'POST') {
      if (refuseNextSend) {
        refuseNextSend = false;
        return json({ name: 'application_error', message: 'Try again later' }, 500);
      }
      const headers = new Headers(init.headers);
      sends.push({
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
        idempotency: headers.get('idempotency-key'),
      });
      return json({ id: `re_sent_${stamp}_${sends.length}` });
    }
    return json({ message: `no route for ${url}` }, 400);
  });

  const one = await createWorkspace(`Email Co ${stamp}`, mail('em-owner'));
  tenantId = one.tenantId;
  users.push(one.ownerId);
  const two = await createWorkspace(`Email Other ${stamp}`, mail('em-other'));
  otherTenant = two.tenantId;
  otherUsers.push(two.ownerId);
  const managerId = await addMember(tenantId, mail('em-manager'), 'Morgan Manager', 'manager');
  users.push(managerId);
  owner = await contextFor(one.ownerId, tenantId);
  manager = await contextFor(managerId, tenantId);
  outsider = await contextFor(two.ownerId, otherTenant);
  const [contact] = await rows<{ id: string }>(sql`
    insert into contacts (tenant_id, first_name, email, email_normalized)
    values (${tenantId}, 'Kim', ${KNOWN}, ${KNOWN}) returning id`);
  knownContactId = contact!.id;
});

afterAll(async () => {
  vi.restoreAllMocks();
  for (const name of ['RESEND_API_KEY', 'INBOX_EMAIL_DOMAIN', 'RESEND_WEBHOOK_SECRET']) {
    delete process.env[name];
  }
  await destroyWorkspace(tenantId, users);
  await destroyWorkspace(otherTenant, otherUsers);
});

/* ------------------------------------------------------------------------ helpers */

let sequence = 0;
function signedEvent(event: unknown, secret = SECRET) {
  sequence += 1;
  const raw = JSON.stringify(event);
  const id = `msg_${stamp}_${sequence}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${raw}`).digest('base64');
  return new Request('http://localhost:3000/api/webhooks/resend', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${signature}`,
    },
    body: raw,
  });
}

/** One email arriving: stored at the simulated Resend, then announced by a signed webhook. */
async function arrives(email: Received): Promise<string> {
  sequence += 1;
  const emailId = `re_in_${stamp}_${sequence}`;
  received.set(emailId, email);
  const response = await resendWebhook(
    signedEvent({
      type: 'email.received',
      created_at: new Date().toISOString(),
      data: {
        email_id: emailId,
        from: parseBare(email.from),
        to: email.to,
        cc: [],
        received_for: email.to,
        message_id: email.messageId,
        subject: email.subject,
        attachments: [],
      },
    }),
  );
  expect(response.status).toBe(200);
  return emailId;
}

const parseBare = (from: string) => /<([^>]+)>/.exec(from)?.[1] ?? from;

async function conversationOf(emailId: string) {
  const [row] = await rows<{
    conversation_id: string;
    body: string;
    email_message_id: string | null;
  }>(sql`select conversation_id, body, email_message_id from social_messages
         where account_id = ${accountId} and external_id = ${emailId}`);
  return row;
}

async function conversation(id: string) {
  const [row] = await rows<{
    participant_email: string;
    participant_name: string | null;
    subject: string;
    reply_token: string;
    contact_id: string | null;
    contact_match: string | null;
  }>(sql`select participant_email, participant_name, subject, reply_token, contact_id, contact_match
         from social_conversations where id = ${id}`);
  return row!;
}

/** A Compose input with plain words, as the editor would send them. */
const compose = (input: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body?: string;
  doc?: EmailDoc;
  attachments?: { path: string; fileName: string; mimeType: string }[];
}) => ({
  accountId,
  to: input.to,
  cc: input.cc ?? [],
  bcc: input.bcc ?? [],
  subject: input.subject,
  doc: input.doc ?? textToEmailDoc(input.body ?? ''),
  attachments: input.attachments ?? [],
});

/* -------------------------------------------------------------------------- tests */

describe('creating an email inbox', () => {
  it('needs social.manage', async () => {
    await expectCode(
      () =>
        createEmailInbox(manager, { name: 'Help', localPart: LOCAL, createLeadForUnknown: false }),
      'FORBIDDEN',
    );
  });

  it('gives the business an address at the platform’s domain', async () => {
    const { id, address } = await createEmailInbox(owner, {
      name: 'Harbour Cafe',
      localPart: LOCAL,
      createLeadForUnknown: false,
    });
    accountId = id;
    expect(address).toBe(INBOX);
  });

  it('counts each connected account’s conversations', async () => {
    await adminDb().execute(sql`
      insert into social_conversations (tenant_id, account_id, participant_id, participant_email)
      values (${tenantId}, ${accountId}, ${`email:count-${stamp}`}, ${`count-${stamp}@example.com`})`);
    const { accounts } = await listAccounts(owner);
    expect(accounts.find((account) => account.id === accountId)?.conversations).toBe(1);
    await adminDb().execute(
      sql`delete from social_conversations where participant_id = ${`email:count-${stamp}`}`,
    );
  });

  it('keeps an address to one business, and the platform’s own addresses to nobody', async () => {
    await expectCode(
      () =>
        createEmailInbox(outsider, { name: 'Copy', localPart: LOCAL, createLeadForUnknown: false }),
      'DUPLICATE',
    );
    await expectCode(
      () =>
        createEmailInbox(owner, {
          name: 'Abuse',
          localPart: 'postmaster',
          createLeadForUnknown: false,
        }),
      'VALIDATION',
    );
  });
});

describe('receiving email', () => {
  let firstEmail: string;
  let threadId: string;

  it('refuses a webhook without a valid signature', async () => {
    const forged = signedEvent(
      { type: 'email.received', data: { email_id: 're_forged', from: STRANGER, to: [INBOX] } },
      'whsec_' + Buffer.from('not-the-real-secret-at-all-xx').toString('base64'),
    );
    expect((await resendWebhook(forged)).status).toBe(403);
    expect(
      (await rows(sql`select 1 from social_messages where external_id = 're_forged'`)).length,
    ).toBe(0);
  });

  it('starts a thread with the subject, the sender and its own reply address', async () => {
    firstEmail = await arrives({
      from: `Kim Known <${KNOWN}>`,
      to: [INBOX],
      subject: 'Order 1042 arrived cold',
      text: 'Hi, our order arrived cold.\n\nOn Mon, 23 Nov 2026, Shop <shop@example.com> wrote:\n> Thanks for your order',
      messageId: `<first-${stamp}@mail.example.com>`,
    });
    const message = await conversationOf(firstEmail);
    expect(message?.body).toBe('Hi, our order arrived cold.');
    expect(message?.email_message_id).toBe(`<first-${stamp}@mail.example.com>`);
    threadId = message!.conversation_id;
    const thread = await conversation(threadId);
    expect(thread).toMatchObject({
      participant_email: KNOWN,
      participant_name: 'Kim Known',
      subject: 'Order 1042 arrived cold',
    });
    expect(thread.reply_token).toMatch(/^[a-z0-9]{24}$/);
  });

  it('links a sender who passed DKIM to the one contact with their address', async () => {
    const thread = await conversation(threadId);
    expect(thread.contact_id).toBe(knownContactId);
    expect(thread.contact_match).toBe('auto');
  });

  it('stores a redelivered email once', async () => {
    const event = {
      type: 'email.received',
      data: { email_id: firstEmail, from: KNOWN, to: [INBOX], attachments: [] },
    };
    expect((await resendWebhook(signedEvent(event))).status).toBe(200);
    const count = await rows<{ n: number }>(
      sql`select count(*)::int as n from social_messages where external_id = ${firstEmail}`,
    );
    expect(count[0]!.n).toBe(1);
  });

  it('never links an unverified sender, only offers the match', async () => {
    const id = await arrives({
      from: KNOWN,
      to: [INBOX],
      subject: 'Please change my booking',
      text: 'Change it to Friday.',
      messageId: `<spoof-${stamp}@mail.example.com>`,
      dkim: 'fail',
    });
    const thread = await conversation((await conversationOf(id))!.conversation_id);
    expect(thread.contact_id).toBeNull();
    expect(thread.contact_match).toBe('suggested');
  });

  it('makes a lead for an unknown verified sender only, when the inbox is set to', async () => {
    await setAccountSettings(owner, { accountId, createLeadForUnknown: true, leadSourceId: null });
    const unverified = await arrives({
      from: `Lee <${STRANGER}>`,
      to: [INBOX],
      subject: 'Quote',
      text: 'How much?',
      messageId: `<u-${stamp}@mail.example.com>`,
      dkim: 'fail',
    });
    expect(
      (await conversation((await conversationOf(unverified))!.conversation_id)).contact_id,
    ).toBeNull();
    const verified = await arrives({
      from: `Lee Lane <${STRANGER}>`,
      to: [INBOX],
      subject: 'Quote again',
      text: 'How much, please?',
      messageId: `<v-${stamp}@mail.example.com>`,
    });
    const thread = await conversation((await conversationOf(verified))!.conversation_id);
    expect(thread.contact_match).toBe('created');
    await setAccountSettings(owner, { accountId, createLeadForUnknown: false, leadSourceId: null });
  });

  it('a reply to the thread’s own address joins the thread', async () => {
    const { reply_token } = await conversation(threadId);
    const id = await arrives({
      from: KNOWN,
      to: [`r-${reply_token}@${DOMAIN}`],
      subject: 'Re: Order 1042 arrived cold',
      text: 'Any update?',
      messageId: `<second-${stamp}@mail.example.com>`,
    });
    expect((await conversationOf(id))?.conversation_id).toBe(threadId);
  });

  it('someone else writing to a thread’s address starts their own thread instead', async () => {
    const { reply_token } = await conversation(threadId);
    const id = await arrives({
      from: STRANGER,
      to: [`r-${reply_token}@${DOMAIN}`],
      subject: 'Re: Order 1042 arrived cold',
      text: 'Let me in',
      messageId: `<intruder-${stamp}@mail.example.com>`,
    });
    expect((await conversationOf(id))?.conversation_id).not.toBe(threadId);
  });

  it('an automatic reply never opens a ticket', async () => {
    await setAccountSettings(owner, {
      accountId,
      createLeadForUnknown: false,
      leadSourceId: null,
      autoTicket: true,
    });
    const id = await arrives({
      from: `noreply-${stamp}@example.com`,
      to: [INBOX],
      subject: 'Out of office',
      text: 'I am away.',
      messageId: `<ooo-${stamp}@mail.example.com>`,
      headers: { 'auto-submitted': 'auto-replied' },
    });
    const conversationId = (await conversationOf(id))!.conversation_id;
    const tickets = await rows(
      sql`select 1 from tickets where conversation_id = ${conversationId}`,
    );
    expect(tickets).toHaveLength(0);
    // A person's new email does open one.
    const real = await arrives({
      from: `Ari <ari-${stamp}@example.com>`,
      to: [INBOX],
      subject: 'Catering for 40',
      text: 'Can you cater on Friday?',
      messageId: `<ari-${stamp}@mail.example.com>`,
    });
    const [ticket] = await rows<{ requester_email: string; source: string }>(sql`
      select requester_email, source from tickets
      where conversation_id = ${(await conversationOf(real))!.conversation_id}`);
    expect(ticket).toEqual({ requester_email: `ari-${stamp}@example.com`, source: 'conversation' });
    await setAccountSettings(owner, {
      accountId,
      createLeadForUnknown: false,
      leadSourceId: null,
      autoTicket: false,
    });
  });
});

describe('replying by email', () => {
  let threadId: string;
  let sentId: string;

  beforeAll(async () => {
    const [row] = await rows<{ id: string }>(sql`
      select id from social_conversations
      where account_id = ${accountId} and participant_email = ${KNOWN} and subject = 'Order 1042 arrived cold'`);
    threadId = row!.id;
  });

  it('sends from the inbox, threaded, with the thread’s reply address', async () => {
    const { messageId } = await replyToConversation(owner, {
      conversationId: threadId,
      body: 'Sorry about that. <b>Refund</b> on its way.',
    });
    const sent = sends.at(-1)!;
    const { reply_token } = await conversation(threadId);
    expect(sent.body).toMatchObject({
      from: `"Harbour Cafe" <${INBOX}>`,
      to: [KNOWN],
      subject: 'Re: Order 1042 arrived cold',
      reply_to: `r-${reply_token}@${DOMAIN}`,
      text: 'Sorry about that. <b>Refund</b> on its way.',
    });
    const headers = sent.body.headers as Record<string, string>;
    expect(headers['In-Reply-To']).toBe(`<second-${stamp}@mail.example.com>`);
    expect(headers.References).toBe(
      `<first-${stamp}@mail.example.com> <second-${stamp}@mail.example.com>`,
    );
    expect(String(sent.body.html)).toContain('&lt;b&gt;Refund&lt;/b&gt;');
    expect(sent.idempotency).toBe(`social-${messageId}`);
    const [message] = await rows<{ status: string; external_id: string }>(
      sql`select status, external_id from social_messages where id = ${messageId}`,
    );
    expect(message?.status).toBe('sent');
    sentId = message!.external_id;
  });

  it('records the Message-ID Resend gave it, then delivery or a bounce', async () => {
    const event = (type: string, extra: Record<string, unknown> = {}) =>
      signedEvent({
        type,
        created_at: new Date().toISOString(),
        data: { email_id: sentId, message_id: `<out-${stamp}@resend.example>`, ...extra },
      });
    expect((await resendWebhook(event('email.sent'))).status).toBe(200);
    expect((await resendWebhook(event('email.delivered'))).status).toBe(200);
    const [delivered] = await rows<{ status: string; email_message_id: string }>(sql`
      select status, email_message_id from social_messages where external_id = ${sentId}`);
    expect(delivered).toEqual({
      status: 'delivered',
      email_message_id: `<out-${stamp}@resend.example>`,
    });
    expect(
      (await resendWebhook(event('email.bounced', { bounce: { type: 'Permanent' } }))).status,
    ).toBe(200);
    const [bounced] = await rows<{ status: string; error: string }>(sql`
      select status, error from social_messages where external_id = ${sentId}`);
    expect(bounced?.status).toBe('failed');
    expect(bounced?.error).toContain('bounced');
  });

  it('the customer’s answer to that reply finds the thread by its headers too', async () => {
    const id = await arrives({
      from: KNOWN,
      to: [INBOX],
      subject: 'Re: Order 1042 arrived cold',
      text: 'Thanks!',
      messageId: `<third-${stamp}@mail.example.com>`,
      headers: { 'in-reply-to': `<out-${stamp}@resend.example>` },
    });
    expect((await conversationOf(id))?.conversation_id).toBe(threadId);
  });

  it('cannot reach another business’s thread', async () => {
    await expectCode(
      () => replyToConversation(outsider, { conversationId: threadId, body: 'Hi' }),
      'NOT_FOUND',
    );
    const theirs = await listConversations(outsider, {});
    expect(theirs.rows.map((row) => row.id)).not.toContain(threadId);
  });
});

describe('starting a new email (ADR-089)', () => {
  const RECIPIENT = `kim-${stamp}@example.com`; // Kim is a contact: her answer links the thread.
  let memberCtx: TenantContext;
  let threadId: string;

  beforeAll(async () => {
    const memberId = await addMember(tenantId, mail('em-member'), 'Mel Member', 'member');
    users.push(memberId);
    memberCtx = await contextFor(memberId, tenantId);
  });

  const sentFolder = async (ctx: TenantContext) =>
    (await listConversations(ctx, { view: 'all', folder: 'sent' }, 'email')).rows.map(
      (row) => row.id,
    );

  it('needs social.reply', async () => {
    const before = sends.length;
    await expectCode(
      () =>
        startEmailConversation(
          memberCtx,
          compose({ to: [RECIPIENT], subject: 'Hello', body: 'Hi' }),
        ),
      'FORBIDDEN',
    );
    expect(sends.length).toBe(before);
  });

  it('cannot send from another business’s inbox', async () => {
    const before = sends.length;
    await expectCode(
      () =>
        startEmailConversation(
          outsider,
          compose({ to: [RECIPIENT], subject: 'Hello', body: 'Hi' }),
        ),
      'NOT_FOUND',
    );
    expect(sends.length).toBe(before);
    const [count] = await rows<{ n: number }>(sql`
      select count(*)::int as n from social_conversations where tenant_id = ${otherTenant}`);
    expect(count?.n).toBe(0);
  });

  it('refuses an address at the inbox domain, which would loop back', async () => {
    await expectCode(
      () =>
        startEmailConversation(
          manager,
          compose({ to: [`someone@${DOMAIN}`], subject: 'Loop', body: 'Hi' }),
        ),
      'VALIDATION',
    );
  });

  it('sends to anyone from the inbox, with the subject as written, as a new thread in Sent', async () => {
    const result = await startEmailConversation(
      manager,
      compose({
        to: [RECIPIENT],
        subject: 'Your catering quote',
        body: 'Hi Kim, here is the quote we discussed.',
      }),
    );
    threadId = result.conversationId;
    const sent = sends.at(-1)!;
    const thread = await conversation(threadId);
    expect(sent.body).toMatchObject({
      from: `"Harbour Cafe" <${INBOX}>`,
      to: [RECIPIENT],
      subject: 'Your catering quote',
      reply_to: `r-${thread.reply_token}@${DOMAIN}`,
      text: 'Hi Kim, here is the quote we discussed.',
    });
    expect((sent.body.headers as Record<string, string>)['In-Reply-To']).toBeUndefined();
    expect(thread.participant_email).toBe(RECIPIENT);
    expect(thread.reply_token).toMatch(/^[a-z0-9]{24}$/);
    // Not linked when sent: the writer may not see every contact with that address.
    expect(thread.contact_id).toBeNull();
    const [row] = await rows<{ assigned_user_id: string; status: string }>(sql`
      select c.assigned_user_id, m.status from social_conversations c
      join social_messages m on m.conversation_id = c.id where c.id = ${threadId}`);
    expect(row).toEqual({ assigned_user_id: manager.userId, status: 'sent' });
    expect(await sentFolder(owner)).toContain(threadId);
    for (const folder of ['customers', 'review', 'filtered'] as const) {
      const { rows: listed } = await listConversations(owner, { view: 'all', folder }, 'email');
      expect(listed.map((item) => item.id)).not.toContain(threadId);
    }
    expect(await sentFolder(outsider)).not.toContain(threadId);
  });

  it('a follow-up before any answer is a reply on the same thread', async () => {
    const [first] = await rows<{ external_id: string }>(sql`
      select external_id from social_messages where conversation_id = ${threadId}`);
    const response = await resendWebhook(
      signedEvent({
        type: 'email.sent',
        created_at: new Date().toISOString(),
        data: { email_id: first!.external_id, message_id: `<quote-${stamp}@resend.example>` },
      }),
    );
    expect(response.status).toBe(200);
    await replyToConversation(manager, { conversationId: threadId, body: 'Also attaching menu.' });
    const sent = sends.at(-1)!;
    expect(sent.body.subject).toBe('Re: Your catering quote');
    expect((sent.body.headers as Record<string, string>)['In-Reply-To']).toBe(
      `<quote-${stamp}@resend.example>`,
    );
  });

  it('their answer joins the thread, links the contact and moves it out of Sent', async () => {
    const { reply_token } = await conversation(threadId);
    const id = await arrives({
      from: RECIPIENT,
      to: [`r-${reply_token}@${DOMAIN}`],
      subject: 'Re: Your catering quote',
      text: 'Looks good, book it.',
      messageId: `<kim-answer-${stamp}@mail.example.com>`,
    });
    expect((await conversationOf(id))?.conversation_id).toBe(threadId);
    expect((await conversation(threadId)).contact_id).toBe(knownContactId);
    expect(await sentFolder(owner)).not.toContain(threadId);
    const customers = await listConversations(owner, { view: 'all', folder: 'customers' }, 'email');
    expect(customers.rows.map((row) => row.id)).toContain(threadId);
  });
});

describe('composing with Cc, Bcc, formatting and files (ADR-090)', () => {
  const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
  const CC = `cc-${stamp}@example.com`;
  const BCC = `bcc-${stamp}@example.com`;
  const OTHER_TO = `also-${stamp}@example.com`;
  const formatted: EmailDoc = [
    {
      type: 'paragraph',
      content: [
        { text: 'Hi, ' },
        { text: 'see the quote', b: true },
        { text: ' and ' },
        { text: '<b>this</b>', href: 'https://example.com/menu' },
      ],
    },
    { type: 'list', ordered: false, items: [[{ text: 'Soup' }], [{ text: 'Bread' }]] },
  ];

  /** A file put where Compose uploads it for this person, as the browser would. */
  async function uploaded(ctx: TenantContext, name: string, bytes = PDF) {
    const ticket = await startComposeUpload(ctx, {
      accountId,
      fileName: name,
      mimeType: 'application/pdf',
      size: bytes.byteLength,
    });
    const { error } = await createSupabaseAdminClient()
      .storage.from('social-media')
      .uploadToSignedUrl(ticket.path, ticket.token, new Blob([bytes]), {
        contentType: 'application/pdf',
      });
    expect(error).toBeNull();
    return { path: ticket.path, fileName: name, mimeType: 'application/pdf' };
  }

  it('sends To, Cc and Bcc, with HTML built from the document and files attached', async () => {
    const file = await uploaded(manager, 'quote.pdf');
    const { conversationId, messageId } = await startEmailConversation(
      manager,
      compose({
        to: [RECIPIENT_COMPOSE, OTHER_TO],
        cc: [CC, RECIPIENT_COMPOSE],
        bcc: [BCC],
        subject: 'Quote and menu',
        doc: formatted,
        attachments: [file],
      }),
    );
    const sent = sends.at(-1)!;
    expect(sent.body.to).toEqual([RECIPIENT_COMPOSE, OTHER_TO]);
    // Each address once: the To address listed again under Cc is left out there.
    expect(sent.body.cc).toEqual([CC]);
    expect(sent.body.bcc).toEqual([BCC]);
    const html = String(sent.body.html);
    expect(html).toContain('<strong>see the quote</strong>');
    expect(html).toContain('href="https://example.com/menu"');
    expect(html).toContain('&lt;b&gt;this&lt;/b&gt;');
    expect(html).toContain('<ul');
    expect(sent.body.text).toBe(
      'Hi, see the quote and <b>this</b> (https://example.com/menu)\n\n- Soup\n- Bread',
    );
    const attachments = sent.body.attachments as { filename: string; path: string }[];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.filename).toBe('quote.pdf');
    // The thread's person is the first To address.
    expect((await conversation(conversationId)).participant_email).toBe(RECIPIENT_COMPOSE);
    const [stored] = await rows<{ email_outbound: unknown; attachments: unknown[] }>(sql`
      select email_outbound, attachments from social_messages where id = ${messageId}`);
    expect(stored?.email_outbound).toEqual({
      to: [RECIPIENT_COMPOSE, OTHER_TO],
      cc: [CC],
      bcc: [BCC],
      doc: formatted,
    });
    expect(stored?.attachments).toEqual([
      expect.objectContaining({ fileName: 'quote.pdf', mimeType: 'application/pdf' }),
    ]);
    // The thread shows the email as sent, recipients and formatting included.
    const thread = await getConversation(manager, conversationId);
    expect(thread?.messages.at(-1)?.composed).toMatchObject({ cc: [CC], bcc: [BCC] });
  });

  it('refuses a file another person uploaded, or one that is not what it says', async () => {
    const theirs = await uploaded(owner, 'theirs.pdf');
    await expectCode(
      () =>
        startEmailConversation(
          manager,
          compose({ to: [RECIPIENT_COMPOSE], subject: 'x', body: 'x', attachments: [theirs] }),
        ),
      'VALIDATION',
    );
    const fake = await uploaded(manager, 'fake.pdf', new TextEncoder().encode('<html>not a pdf'));
    await expectCode(
      () =>
        startEmailConversation(
          manager,
          compose({ to: [RECIPIENT_COMPOSE], subject: 'x', body: 'x', attachments: [fake] }),
        ),
      'VALIDATION',
    );
  });

  it('a refused send is retried as the same email: recipients, formatting and files', async () => {
    const file = await uploaded(manager, 'menu.pdf');
    refuseNextSend = true;
    const { messageId, failed: reason } = await startEmailConversation(
      manager,
      compose({
        to: [RECIPIENT_COMPOSE],
        cc: [CC],
        subject: 'Retry me',
        doc: formatted,
        attachments: [file],
      }),
    );
    const [failed] = await rows<{ status: string }>(
      sql`select status from social_messages where id = ${messageId}`,
    );
    expect(failed?.status).toBe('failed');
    // Returned with the thread, not thrown: Compose opens the thread, where Retry is.
    expect(reason).toContain('Not sent');
    await retryReply(manager, messageId);
    const sent = sends.at(-1)!;
    expect(sent.body).toMatchObject({ to: [RECIPIENT_COMPOSE], cc: [CC], subject: 'Retry me' });
    expect(String(sent.body.html)).toContain('<strong>see the quote</strong>');
    expect((sent.body.attachments as { filename: string }[])[0]?.filename).toBe('menu.pdf');
  });

  it('counts every recipient against the daily limit', async () => {
    const many = Array.from({ length: 50 }, (_, index) => `bulk-${index}-${stamp}@example.com`);
    let refused = false;
    for (let round = 0; round < 6 && !refused; round += 1) {
      refused = await startEmailConversation(
        owner,
        compose({ to: many.slice(0, 25), bcc: many.slice(25), subject: 'Bulk', body: 'x' }),
      ).then(
        () => false,
        (error: unknown) => error instanceof AppError && error.code === 'RATE_LIMITED',
      );
    }
    // 200 recipients a day per person: the fifth email of 50 is refused.
    expect(refused).toBe(true);
  });

  it('a signed-in person can never write a received email’s sender checks', async () => {
    const [thread] = await rows<{ id: string }>(sql`
      select id from social_conversations where account_id = ${accountId} limit 1`);
    const insert = (values: Record<string, unknown>) =>
      withRls(manager, (tx) =>
        tx.execute(sql`
          insert into social_messages (tenant_id, conversation_id, account_id, direction, body,
            sent_at, status, email_meta, email_message_id, email_outbound)
          values (${tenantId}, ${thread!.id}, ${accountId}, ${String(values.direction)}, 'forged',
            now(), 'received', ${values.meta ?? null}::jsonb, ${values.messageId ?? null},
            ${values.outbound ?? null}::jsonb)`),
      ).then(
        () => 'stored',
        () => 'refused',
      );
    expect(await insert({ direction: 'inbound', meta: JSON.stringify({ verified: true }) })).toBe(
      'refused',
    );
    expect(await insert({ direction: 'inbound', messageId: `<forged-${stamp}@x>` })).toBe(
      'refused',
    );
    expect(
      await insert({ direction: 'inbound', outbound: JSON.stringify({ to: [], doc: [] }) }),
    ).toBe('refused');
  });
});

describe('the email feature switch', () => {
  it('hides email threads, but not social ones, while only email is off', async () => {
    const [social] = await rows<{ id: string }>(sql`
      insert into social_accounts (tenant_id, platform, external_id, name)
      values (${tenantId}, 'whatsapp', ${`7${stamp}`}, 'Harbour WhatsApp') returning id`);
    await adminDb().execute(sql`
      insert into social_conversations (tenant_id, account_id, participant_id, participant_phone, last_message_at)
      values (${tenantId}, ${social!.id}, '61499000000', '61499000000', now())`);
    await adminDb().execute(
      sql`update tenants set features = array_remove(features, 'email_channel') where id = ${tenantId}`,
    );
    try {
      const ctx = await contextFor(owner.userId, tenantId);
      const platforms = new Set((await listConversations(ctx, {})).rows.map((row) => row.platform));
      expect(platforms.has('whatsapp')).toBe(true);
      expect(platforms.has('email')).toBe(false);
      await expectCode(
        () =>
          createEmailInbox(ctx, {
            name: 'X',
            localPart: `x-${stamp}`,
            createLeadForUnknown: false,
          }),
        'FORBIDDEN',
      );
    } finally {
      await adminDb().execute(
        sql`update tenants set features = features || array['email_channel'] where id = ${tenantId}`,
      );
    }
  });

  it('keeps the inbox open with email on and social media off, showing only email', async () => {
    await adminDb().execute(
      sql`update tenants set features = array_remove(features, 'social') where id = ${tenantId}`,
    );
    try {
      const ctx = await contextFor(owner.userId, tenantId);
      expect(ctx.grants.has('social.view')).toBe(true);
      // Email is its own area (ADR-073): every folder holds email only, the Social inbox nothing.
      const platforms = new Set<string>();
      for (const folder of ['customers', 'review', 'filtered', 'sent'] as const) {
        const { rows } = await listConversations(ctx, { view: 'all', folder }, 'email');
        for (const row of rows) platforms.add(row.platform);
      }
      expect(platforms).toEqual(new Set(['email']));
      expect((await listConversations(ctx, { view: 'all' }, 'social')).rows).toEqual([]);
      const seen = (await withRls(ctx, (tx) =>
        tx.execute(sql`select count(*)::int as n from social_accounts where platform = 'whatsapp'`),
      )) as unknown as { n: number }[];
      expect(seen[0]!.n).toBe(0);
    } finally {
      await adminDb().execute(
        sql`update tenants set features = features || array['social'] where id = ${tenantId}`,
      );
    }
  });
});

describe('erasing a person', () => {
  it('clears their address, the subject and what their emails said', async () => {
    await anonymizeContact(owner, knownContactId);
    const [thread] = await rows<{ participant_email: string | null; subject: string | null }>(sql`
      select participant_email, subject from social_conversations
      where contact_id = ${knownContactId} limit 1`);
    expect(thread).toEqual({ participant_email: null, subject: null });
    const leftovers = await rows(sql`
      select 1 from social_messages m join social_conversations c on c.id = m.conversation_id
      where c.contact_id = ${knownContactId} and m.direction = 'inbound'
        and (m.email_meta is not null or m.body <> 'Erased on request')`);
    expect(leftovers).toHaveLength(0);
    // Who the business's composed emails went to is erased too (ADR-090); its words stay.
    const recipients = await rows(sql`
      select 1 from social_messages m join social_conversations c on c.id = m.conversation_id
      where c.contact_id = ${knownContactId} and m.email_outbound is not null
        and (m.email_outbound ? 'to' or m.email_outbound ? 'cc' or m.email_outbound ? 'bcc')`);
    expect(recipients).toHaveLength(0);
    // The thread page still opens.
    const conversationId = (
      await rows<{ id: string }>(
        sql`select id from social_conversations where contact_id = ${knownContactId} limit 1`,
      )
    )[0]!.id;
    expect(await getConversation(owner, conversationId)).not.toBeNull();
  });
});
