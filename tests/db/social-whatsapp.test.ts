import { createHmac } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { POST as metaWebhook } from '@/app/api/webhooks/meta/route';
import { AppError } from '@/lib/errors';
import { anonymizeContact } from '@/modules/contacts/privacy';
import { createContactSchema } from '@/modules/contacts/schemas';
import { createContact } from '@/modules/contacts/service';
import { readCredentials } from '@/modules/social/credentials';
import { sendableTemplates } from '@/modules/social/queries';
import {
  disconnectAccount,
  linkConversationContact,
  replyToConversation,
  retryReply,
  sendTemplateReply,
} from '@/modules/social/service';
import {
  connectWhatsApp,
  createTemplate,
  deleteTemplate,
  refreshTemplates,
} from '@/modules/social/whatsapp-service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

// WhatsApp in the social inbox (ADR-066). Meta is simulated at the network edge only; the
// database, row-level security, the credential functions, the webhook route and the services
// are the real ones.

vi.hoisted(() => {
  process.env.META_APP_ID = 'meta-app-1';
  process.env.META_APP_SECRET = 'meta-secret-0123456789abcdef';
  process.env.META_WHATSAPP_CONFIG_ID = 'wa-config-1';
  process.env.META_WEBHOOK_VERIFY_TOKEN = 'verify-token-0123456789';
});

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;
const WABA = `1${stamp}`;
const NUMBER = `2${stamp}`;
const APP_NUMBER = `3${stamp}`;
const CUSTOMER = `61400${String(stamp).slice(-6)}`;
const APP_CUSTOMER = `61411${String(stamp).slice(-6)}`;
const TOKEN = 'BISU_WHATSAPP_TOKEN';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

let tenantId: string;
let otherTenant: string;
const users: string[] = [];
const otherUsers: string[] = [];
let owner: TenantContext;
let manager: TenantContext;
let staff: TenantContext;
let outsider: TenantContext;

/* ------------------------------------------------------------------ simulated Meta */

type Call = { method: string; url: string; body: string; authorization: string | null };
const calls: Call[] = [];
const realFetch = globalThis.fetch;
type Handler = (call: Call) => unknown | Promise<unknown>;
let routes: [RegExp, Handler][] = [];
const route = (method: string, pattern: RegExp, handler: Handler) =>
  routes.unshift([new RegExp(`^${method} ${pattern.source}`), handler]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let sent = 0;
function whatsappHappyPath(numbers = [NUMBER, APP_NUMBER]) {
  route('POST', /https:\/\/graph\.facebook\.com\/v\d+\.\d+\/oauth\/access_token/, () =>
    json({ access_token: TOKEN }),
  );
  route('GET', new RegExp(`.*/${WABA}/phone_numbers`), () =>
    json({
      data: numbers.map((id, index) => ({
        id,
        display_phone_number: `+61 400 000 00${index}`,
        verified_name: index === 0 ? 'Harbour Cafe' : 'Harbour Cafe (app)',
      })),
    }),
  );
  route('POST', new RegExp(`.*/${WABA}/subscribed_apps`), () => json({ success: true }));
  route('DELETE', new RegExp(`.*/${WABA}/subscribed_apps`), () => json({ success: true }));
  route('POST', /.*\/\d+\/register/, () => json({ success: true }));
  route('POST', /.*\/\d+\/smb_app_data/, () => json({ request_id: 'req-1' }));
  route('GET', new RegExp(`.*/${WABA}/message_templates`), () =>
    json({
      data: [
        {
          id: 'tpl-ready',
          name: 'order_ready',
          language: 'en',
          status: 'APPROVED',
          category: 'UTILITY',
          components: [{ type: 'BODY', text: 'Hi {{1}}, order {{2}} is ready.' }],
        },
        {
          id: 'tpl-picture',
          name: 'weekly_special',
          language: 'en',
          status: 'APPROVED',
          category: 'MARKETING',
          components: [
            { type: 'HEADER', format: 'IMAGE' },
            { type: 'BODY', text: 'This week: {{1}}' },
          ],
        },
      ],
    }),
  );
  route('POST', /.*\/\d+\/messages/, () => {
    sent += 1;
    return json({ messages: [{ id: `wamid.OUT${stamp}.${sent}` }] });
  });
  route('GET', /.*\/media-\w+\?phone_number_id=/, () =>
    json({ url: `https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=${stamp}` }),
  );
}

beforeAll(async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!/^https:\/\/(graph\.facebook\.com|lookaside\.fbsbx\.com)\//.test(url)) {
      return realFetch(input, init);
    }
    const headers = new Headers(init?.headers);
    const call = {
      method: (init?.method ?? 'GET').toUpperCase(),
      url,
      body: typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : '',
      authorization: headers.get('authorization'),
    };
    calls.push(call);
    if (url.startsWith('https://lookaside.fbsbx.com/')) {
      return call.authorization === `Bearer ${TOKEN}`
        ? new Response(new Blob([JPEG]), { headers: { 'content-type': 'image/jpeg' } })
        : new Response('no', { status: 401 });
    }
    const match = routes.find(([pattern]) => pattern.test(`${call.method} ${url}`));
    if (!match)
      return json({ error: { message: `no route for ${call.method} ${url}`, code: 1 } }, 400);
    const result = await match[1](call);
    return result instanceof Response ? result : json(result);
  });

  const one = await createWorkspace(`WhatsApp Co ${stamp}`, mail('wa-owner'));
  tenantId = one.tenantId;
  users.push(one.ownerId);
  const two = await createWorkspace(`WhatsApp Other ${stamp}`, mail('wa-other'));
  otherTenant = two.tenantId;
  otherUsers.push(two.ownerId);
  const managerId = await addMember(tenantId, mail('wa-manager'), 'Morgan Manager', 'manager');
  const staffId = await addMember(tenantId, mail('wa-staff'), 'Sky Staff', 'member');
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
    'META_WHATSAPP_CONFIG_ID',
    'META_WEBHOOK_VERIFY_TOKEN',
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

async function numberAccount(externalId: string) {
  const [row] = await rows<{
    id: string;
    provider_business_id: string;
    coexistence: boolean;
    history_sync: string | null;
    history_progress: number | null;
    last_error: string | null;
    disconnected_at: string | null;
  }>(sql`
    select id, provider_business_id, coexistence, history_sync, history_progress, last_error,
           disconnected_at
    from social_accounts
    where tenant_id = ${tenantId} and platform = 'whatsapp' and external_id = ${externalId}
    order by connected_at desc limit 1`);
  return row!;
}

async function conversationWith(participant: string) {
  const [row] = await rows<{
    id: string;
    participant_name: string | null;
    participant_phone: string | null;
    unread_count: number;
    last_inbound_at: string | null;
  }>(sql`
    select id, participant_name, participant_phone, unread_count, last_inbound_at
    from social_conversations where tenant_id = ${tenantId} and participant_id = ${participant}`);
  return row!;
}

async function message(externalId: string) {
  const [row] = await rows<{
    id: string;
    direction: string;
    status: string;
    body: string | null;
    error: string | null;
    attachments: { type: string; state?: string; placeholder?: boolean }[];
  }>(sql`
    select id, direction, status, body, error, attachments from social_messages
    where tenant_id = ${tenantId} and external_id = ${externalId}`);
  return row;
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

const webhook = (phoneNumberId: string, field: string, value: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: WABA,
      changes: [
        {
          field,
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '61400000000', phone_number_id: phoneNumberId },
            ...value,
          },
        },
      ],
    },
  ],
});

const seconds = (date = new Date()) => String(Math.floor(date.getTime() / 1000));

const templateId = async (name: string, number = NUMBER) => {
  const [row] = await rows<{ id: string }>(sql`
    select t.id from social_message_templates t
    join social_accounts a on a.id = t.account_id
    where t.tenant_id = ${tenantId} and t.name = ${name} and a.external_id = ${number}`);
  return row!.id;
};

/* ------------------------------------------------------------------------------ tests */

describe('connecting a WhatsApp number', () => {
  it('refuses people without social.manage', async () => {
    whatsappHappyPath();
    const input = { code: 'CODE', wabaId: WABA, phoneNumberId: NUMBER, coexistence: false };
    await expectCode(() => connectWhatsApp(manager, input), 'FORBIDDEN');
    await expectCode(() => connectWhatsApp(staff, input), 'FORBIDDEN');
  });

  it('refuses a number the business’s own token cannot find, and saves nothing', async () => {
    whatsappHappyPath(['999']);
    await expectCode(
      () =>
        connectWhatsApp(owner, {
          code: 'CODE',
          wabaId: WABA,
          phoneNumberId: NUMBER,
          coexistence: false,
        }),
      'CONFLICT',
    );
    const found = await rows<{ n: number }>(sql`
      select count(*)::int as n from social_accounts where external_id = ${NUMBER}`);
    expect(found[0]?.n).toBe(0);
  });

  it('saves a new number with a sealed token, registers it with a PIN and brings its templates', async () => {
    whatsappHappyPath();
    calls.length = 0;
    const result = await connectWhatsApp(owner, {
      code: 'CODE',
      wabaId: WABA,
      phoneNumberId: NUMBER,
      coexistence: false,
    });
    expect(result.warning).toBeNull();
    const account = await numberAccount(NUMBER);
    expect(account).toMatchObject({ provider_business_id: WABA, coexistence: false });
    expect(account.history_sync).toBeNull();

    const credentials = await withRls(owner, (tx) =>
      readCredentials(tx, tenantId, result.accountId),
    );
    expect(credentials?.accessToken).toBe(TOKEN);
    expect(credentials?.refreshToken).toMatch(/^\d{6}$/);
    const register = calls.find((call) => call.url.endsWith(`/${NUMBER}/register`));
    expect(JSON.parse(register!.body)).toEqual({
      messaging_product: 'whatsapp',
      pin: credentials?.refreshToken,
    });
    expect(calls.some((call) => call.url.includes(`/${WABA}/subscribed_apps`))).toBe(true);
    // The token travels in a header, never in an address.
    expect(calls.every((call) => !call.url.includes(TOKEN))).toBe(true);
    expect(calls.some((call) => call.url.includes('smb_app_data'))).toBe(false);

    const templates = await rows<{ name: string; status: string; sendable: boolean }>(sql`
      select name, status, sendable from social_message_templates
      where tenant_id = ${tenantId} and account_id = ${result.accountId} order by name`);
    expect(templates).toEqual([
      { name: 'order_ready', status: 'approved', sendable: true },
      { name: 'weekly_special', status: 'approved', sendable: false },
    ]);
    const audited = await rows<{ n: number }>(sql`
      select count(*)::int as n from audit_logs
      where tenant_id = ${tenantId} and entity_type = 'social_account'
        and entity_id = ${result.accountId}`);
    expect(audited[0]?.n).toBe(1);
  });

  it('will not connect a number that is live in another business', async () => {
    whatsappHappyPath();
    await expectCode(
      () =>
        connectWhatsApp(outsider, {
          code: 'CODE',
          wabaId: WABA,
          phoneNumberId: NUMBER,
          coexistence: false,
        }),
      'CONFLICT',
    );
  });

  it('a WhatsApp Business app number is not registered again; its contacts and chats are asked for', async () => {
    whatsappHappyPath();
    calls.length = 0;
    await connectWhatsApp(owner, {
      code: 'CODE2',
      wabaId: WABA,
      phoneNumberId: APP_NUMBER,
      coexistence: true,
    });
    const account = await numberAccount(APP_NUMBER);
    expect(account).toMatchObject({ coexistence: true, history_sync: 'requested' });
    expect(calls.some((call) => call.url.endsWith(`/${APP_NUMBER}/register`))).toBe(false);
    const syncs = calls
      .filter((call) => call.url.endsWith(`/${APP_NUMBER}/smb_app_data`))
      .map((call) => (JSON.parse(call.body) as { sync_type: string }).sync_type);
    expect(syncs).toEqual(['smb_app_state_sync', 'history']);
  });
});

describe('WhatsApp webhooks', () => {
  it('stores a customer’s message for the business with the number, and saves the photo with the token', async () => {
    whatsappHappyPath();
    calls.length = 0;
    const body = webhook(NUMBER, 'messages', {
      contacts: [{ profile: { name: 'Jamie Customer' }, wa_id: CUSTOMER }],
      messages: [
        {
          from: CUSTOMER,
          id: `wamid.IN${stamp}`,
          timestamp: seconds(),
          type: 'text',
          text: { body: 'Do you deliver to Bondi?' },
        },
        {
          from: CUSTOMER,
          id: `wamid.IMG${stamp}`,
          timestamp: seconds(),
          type: 'image',
          image: { id: `media-${stamp}`, mime_type: 'image/jpeg', caption: 'This one' },
        },
      ],
    });
    expect((await metaWebhook(signed(body))).status).toBe(200);
    expect((await metaWebhook(signed(body))).status).toBe(200);
    const conversation = await conversationWith(CUSTOMER);
    expect(conversation).toMatchObject({
      participant_name: 'Jamie Customer',
      participant_phone: CUSTOMER,
      unread_count: 2,
    });
    expect(conversation.last_inbound_at).not.toBeNull();
    expect(await message(`wamid.IN${stamp}`)).toMatchObject({
      direction: 'inbound',
      body: 'Do you deliver to Bondi?',
    });
    const photo = await message(`wamid.IMG${stamp}`);
    expect(photo?.body).toBe('This one');
    expect(photo?.attachments[0]?.state).toBe('stored');
    const download = calls.find((call) => call.url.startsWith('https://lookaside.fbsbx.com/'));
    expect(download?.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('stores nothing from a body without Meta’s signature', async () => {
    const body = webhook(NUMBER, 'messages', {
      messages: [
        {
          from: CUSTOMER,
          id: `wamid.FORGED${stamp}`,
          timestamp: seconds(),
          type: 'text',
          text: { body: 'forged' },
        },
      ],
    });
    const unsigned = new Request('http://localhost:3000/api/webhooks/meta', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    expect((await metaWebhook(unsigned)).status).toBe(403);
    expect(await message(`wamid.FORGED${stamp}`)).toBeUndefined();
  });

  it('a number no business has live is ignored', async () => {
    const body = webhook('42', 'messages', {
      messages: [
        {
          from: CUSTOMER,
          id: `wamid.NOBODY${stamp}`,
          timestamp: seconds(),
          type: 'text',
          text: { body: 'hi' },
        },
      ],
    });
    expect((await metaWebhook(signed(body))).status).toBe(200);
    const stored = await rows<{ n: number }>(sql`
      select count(*)::int as n from social_messages where external_id = ${`wamid.NOBODY${stamp}`}`);
    expect(stored[0]?.n).toBe(0);
  });
});

describe('replying on WhatsApp', () => {
  it('free text within 24 hours, to the customer’s number, then delivered and read', async () => {
    whatsappHappyPath();
    calls.length = 0;
    const conversation = await conversationWith(CUSTOMER);
    const { messageId } = await replyToConversation(manager, {
      conversationId: conversation.id,
      body: 'Yes, we do!',
    });
    const send = calls.find((call) => call.url.endsWith(`/${NUMBER}/messages`));
    expect(JSON.parse(send!.body)).toMatchObject({
      messaging_product: 'whatsapp',
      to: `+${CUSTOMER}`,
      type: 'text',
      text: { body: 'Yes, we do!' },
    });
    const [stored] = await rows<{ external_id: string; status: string }>(sql`
      select external_id, status from social_messages where id = ${messageId}`);
    expect(stored?.status).toBe('sent');

    const status = (state: string) =>
      webhook(NUMBER, 'messages', {
        statuses: [
          { id: stored!.external_id, status: state, timestamp: seconds(), recipient_id: CUSTOMER },
        ],
      });
    await metaWebhook(signed(status('read')));
    await metaWebhook(signed(status('delivered')));
    expect((await message(stored!.external_id))?.status).toBe('read');
  });

  it('after 24 hours only an approved template; the reply box refuses free text', async () => {
    whatsappHappyPath();
    const conversation = await conversationWith(CUSTOMER);
    await adminDb().execute(sql`
      update social_conversations set last_inbound_at = now() - interval '2 days'
      where id = ${conversation.id}`);
    await expectCode(
      () => replyToConversation(manager, { conversationId: conversation.id, body: 'Hello?' }),
      'CONFLICT',
    );
    const offered = await sendableTemplates(manager, (await numberAccount(NUMBER)).id);
    expect(offered.map((template) => template.name)).toEqual(['order_ready']);

    calls.length = 0;
    const ready = await templateId('order_ready');
    const { messageId } = await sendTemplateReply(manager, {
      conversationId: conversation.id,
      templateId: ready,
      values: ['Jamie', 'A-102'],
    });
    const send = calls.find((call) => call.url.endsWith(`/${NUMBER}/messages`));
    expect(JSON.parse(send!.body)).toMatchObject({
      to: `+${CUSTOMER}`,
      type: 'template',
      template: {
        name: 'order_ready',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Jamie' },
              { type: 'text', text: 'A-102' },
            ],
          },
        ],
      },
    });
    const [stored] = await rows<{ body: string; status: string }>(sql`
      select body, status from social_messages where id = ${messageId}`);
    expect(stored).toEqual({ body: 'Hi Jamie, order A-102 is ready.', status: 'sent' });

    await expectCode(
      () =>
        sendTemplateReply(manager, {
          conversationId: conversation.id,
          templateId: ready,
          values: ['Jamie'],
        }),
      'VALIDATION',
    );
    const picture = await templateId('weekly_special');
    await expectCode(
      () =>
        sendTemplateReply(manager, {
          conversationId: conversation.id,
          templateId: picture,
          values: ['Pies'],
        }),
      'CONFLICT',
    );
    await expectCode(
      () =>
        sendTemplateReply(staff, {
          conversationId: conversation.id,
          templateId: ready,
          values: ['Jamie', 'A-102'],
        }),
      'FORBIDDEN',
    );
  });

  it('a failure WhatsApp reports later says why, and Retry sends the same template again', async () => {
    whatsappHappyPath();
    const [last] = await rows<{ id: string; external_id: string }>(sql`
      select id, external_id from social_messages
      where tenant_id = ${tenantId} and template is not null order by created_at desc limit 1`);
    await metaWebhook(
      signed(
        webhook(NUMBER, 'messages', {
          statuses: [
            {
              id: last!.external_id,
              status: 'failed',
              timestamp: seconds(),
              recipient_id: CUSTOMER,
              errors: [{ code: 131042, title: 'Business eligibility payment issue' }],
            },
          ],
        }),
      ),
    );
    const failed = await message(last!.external_id);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toContain('payment method');

    calls.length = 0;
    await retryReply(manager, last!.id);
    const resend = calls.find((call) => call.url.endsWith(`/${NUMBER}/messages`));
    expect(JSON.parse(resend!.body)).toMatchObject({ type: 'template' });
  });
});

describe('a WhatsApp Business app number', () => {
  it('imports the app’s history without opening the reply window, and fills in late photos', async () => {
    whatsappHappyPath();
    const day = 86_400_000;
    const history = (progress: number, messages: Record<string, unknown>[]) =>
      webhook(APP_NUMBER, 'history', {
        history: [
          {
            metadata: { phase: 0, chunk_order: 1, progress },
            threads: [{ id: APP_CUSTOMER, context: { wa_id: APP_CUSTOMER }, messages }],
          },
        ],
      });
    await metaWebhook(
      signed(
        history(50, [
          {
            from: APP_CUSTOMER,
            id: `wamid.H1${stamp}`,
            timestamp: seconds(new Date(Date.now() - 3 * day)),
            type: 'text',
            text: { body: 'Can I book for Friday?' },
          },
          {
            from: '61400000000',
            id: `wamid.H2${stamp}`,
            timestamp: seconds(new Date(Date.now() - 3 * day + 60_000)),
            type: 'text',
            text: { body: 'Booked!' },
            history_context: { status: 'READ' },
          },
          {
            from: APP_CUSTOMER,
            id: `wamid.H3${stamp}`,
            timestamp: seconds(new Date(Date.now() - 2 * day)),
            type: 'media_placeholder',
          },
        ]),
      ),
    );
    const conversation = await conversationWith(APP_CUSTOMER);
    expect(conversation).toMatchObject({ unread_count: 0, last_inbound_at: null });
    expect(await message(`wamid.H2${stamp}`)).toMatchObject({
      direction: 'outbound',
      status: 'read',
    });
    expect((await message(`wamid.H3${stamp}`))?.attachments[0]).toMatchObject({
      placeholder: true,
      state: 'skipped',
    });
    expect(await numberAccount(APP_NUMBER)).toMatchObject({
      history_sync: 'in_progress',
      history_progress: 50,
    });

    await metaWebhook(
      signed(
        history(100, [
          {
            from: APP_CUSTOMER,
            id: `wamid.H3${stamp}`,
            timestamp: seconds(new Date(Date.now() - 2 * day)),
            type: 'image',
            image: { id: `media-h${stamp}`, mime_type: 'image/jpeg' },
          },
        ]),
      ),
    );
    expect((await message(`wamid.H3${stamp}`))?.attachments[0]?.state).toBe('stored');
    expect(await numberAccount(APP_NUMBER)).toMatchObject({
      history_sync: 'complete',
      history_progress: 100,
    });
  });

  it('shows what the business sends from the phone app, with its edits and deletions, and the app’s names', async () => {
    const echo = (value: Record<string, unknown>) =>
      signed(webhook(APP_NUMBER, 'smb_message_echoes', { message_echoes: [value] }));
    await metaWebhook(
      echo({
        from: '61400000000',
        to: APP_CUSTOMER,
        id: `wamid.E1${stamp}`,
        timestamp: seconds(),
        type: 'text',
        text: { body: 'See you Friday at 7' },
      }),
    );
    expect(await message(`wamid.E1${stamp}`)).toMatchObject({
      direction: 'outbound',
      body: 'See you Friday at 7',
    });
    await metaWebhook(
      echo({
        from: '61400000000',
        to: APP_CUSTOMER,
        id: `wamid.E1edit${stamp}`,
        timestamp: seconds(),
        type: 'edit',
        edit: {
          original_message_id: `wamid.E1${stamp}`,
          message: { type: 'text', text: { body: 'See you Friday at 7:30' } },
        },
      }),
    );
    expect((await message(`wamid.E1${stamp}`))?.body).toBe('See you Friday at 7:30');
    await metaWebhook(
      echo({
        from: '61400000000',
        to: APP_CUSTOMER,
        id: `wamid.E1revoke${stamp}`,
        timestamp: seconds(),
        type: 'revoke',
        revoke: { original_message_id: `wamid.E1${stamp}` },
      }),
    );
    expect((await message(`wamid.E1${stamp}`))?.body).toBe('This message was deleted.');

    await metaWebhook(
      signed(
        webhook(APP_NUMBER, 'smb_app_state_sync', {
          state_sync: [
            {
              type: 'contact',
              action: 'add',
              contact: { full_name: 'Riley (Friday booking)', phone_number: `+${APP_CUSTOMER}` },
            },
          ],
        }),
      ),
    );
    expect((await conversationWith(APP_CUSTOMER)).participant_name).toBe('Riley (Friday booking)');
  });

  it('records that the business turned history sharing off', async () => {
    await metaWebhook(
      signed(
        webhook(APP_NUMBER, 'history', {
          history: [{ metadata: { phase: 1 }, errors: [{ code: 2593109 }], threads: [] }],
        }),
      ),
    );
    expect((await numberAccount(APP_NUMBER)).history_sync).toBe('declined');
  });
});

describe('WhatsApp templates', () => {
  it('belong to the business: other businesses and people without the inbox cannot read them', async () => {
    const count = async (ctx: TenantContext) =>
      (
        (await withRls(ctx, (tx) =>
          tx.execute(sql`select count(*)::int as n from social_message_templates
                         where tenant_id = ${tenantId}`),
        )) as unknown as { n: number }[]
      )[0]?.n;
    expect(await count(manager)).toBeGreaterThan(0);
    expect(await count(outsider)).toBe(0);
    expect(await count(staff)).toBe(0);

    const account = await numberAccount(NUMBER);
    const insert = (ctx: TenantContext) =>
      withRls(ctx, (tx) =>
        tx.execute(sql`insert into social_message_templates
          (tenant_id, account_id, external_id, name, language, category, status, body)
          values (${tenantId}, ${account.id}, ${`forged-${stamp}`}, 'forged', 'en', 'utility',
                  'approved', 'Forged')`),
      );
    expect(await sqlState(() => insert(manager))).toBe('42501');
    expect(await sqlState(() => insert(outsider))).toBe('42501');

    await adminDb().execute(
      sql`update tenants set features = array_remove(features, 'social') where id = ${tenantId}`,
    );
    try {
      expect(await count(await contextFor(owner.userId, tenantId))).toBe(0);
    } finally {
      await adminDb().execute(
        sql`update tenants set features = array_append(features, 'social') where id = ${tenantId}`,
      );
    }
  });

  it('a new template goes to Meta for review and stays pending here; deleting it removes it from both', async () => {
    whatsappHappyPath();
    route('POST', new RegExp(`.*/${WABA}/message_templates`), () =>
      json({ id: `tpl-new-${stamp}`, status: 'PENDING', category: 'UTILITY' }),
    );
    route('DELETE', new RegExp(`.*/${WABA}/message_templates`), () => json({ success: true }));
    const account = await numberAccount(NUMBER);
    const input = {
      accountId: account.id,
      name: 'table_ready',
      category: 'utility' as const,
      language: 'en' as const,
      body: 'Hi {{1}}, your table is ready.',
      examples: ['Sam'],
      headerText: null,
      footerText: 'Reply STOP to opt out',
    };
    await expectCode(() => createTemplate(manager, input), 'FORBIDDEN');
    calls.length = 0;
    const { templateId: created } = await createTemplate(owner, input);
    const submitted = calls.find(
      (call) => call.method === 'POST' && call.url.includes('/message_templates'),
    );
    expect(JSON.parse(submitted!.body)).toMatchObject({
      name: 'table_ready',
      category: 'UTILITY',
      language: 'en',
      components: [
        { type: 'BODY', text: 'Hi {{1}}, your table is ready.', example: { body_text: [['Sam']] } },
        { type: 'FOOTER', text: 'Reply STOP to opt out' },
      ],
    });
    const [pending] = await rows<{ status: string; parameters: string[] }>(sql`
      select status, parameters from social_message_templates where id = ${created}`);
    expect(pending).toEqual({ status: 'pending', parameters: ['1'] });

    await metaWebhook(
      signed({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: WABA,
            changes: [
              {
                field: 'message_template_status_update',
                value: {
                  event: 'REJECTED',
                  message_template_id: `tpl-new-${stamp}`,
                  message_template_name: 'table_ready',
                  message_template_language: 'en',
                  reason: 'INVALID_FORMAT',
                },
              },
            ],
          },
        ],
      }),
    );
    const [rejected] = await rows<{ status: string; reason: string }>(sql`
      select status, reason from social_message_templates where id = ${created}`);
    expect(rejected).toEqual({ status: 'rejected', reason: 'INVALID_FORMAT' });

    calls.length = 0;
    await deleteTemplate(owner, created);
    const removal = calls.find((call) => call.method === 'DELETE');
    expect(removal?.url).toContain(`hsm_id=tpl-new-${stamp}`);
    const left = await rows<{ n: number }>(sql`
      select count(*)::int as n from social_message_templates where id = ${created}`);
    expect(left[0]?.n).toBe(0);
  });

  it('Refresh removes templates deleted in WhatsApp Manager', async () => {
    route('GET', new RegExp(`.*/${WABA}/message_templates`), () => json({ data: [] }));
    route('POST', /https:\/\/graph\.facebook\.com\/v\d+\.\d+\/oauth\/access_token/, () =>
      json({ access_token: TOKEN }),
    );
    expect(await refreshTemplates(owner, (await numberAccount(APP_NUMBER)).id)).toBe(0);
    const number = (await numberAccount(NUMBER)).id;
    await expectCode(() => refreshTemplates(manager, number), 'FORBIDDEN');
  });
});

describe('privacy and disconnecting', () => {
  it('erasing a person forgets their WhatsApp number, which is also their id in the conversation', async () => {
    const contact = await createContact(
      owner,
      createContactSchema.parse({ firstName: 'Jamie', lastName: 'Customer', email: mail('jamie') }),
    );
    const conversation = await conversationWith(CUSTOMER);
    await linkConversationContact(owner, {
      conversationId: conversation.id,
      contactId: contact.id,
    });
    await anonymizeContact(owner, contact.id);
    const [erased] = await rows<{
      participant_id: string;
      participant_phone: string | null;
      participant_name: string;
    }>(sql`
      select participant_id, participant_phone, participant_name from social_conversations
      where id = ${conversation.id}`);
    expect(erased).toEqual({
      participant_id: `erased:${conversation.id}`,
      participant_phone: null,
      participant_name: 'Erased',
    });
  });

  it('the account’s webhook stays on until its last connected number is disconnected', async () => {
    whatsappHappyPath();
    calls.length = 0;
    await disconnectAccount(owner, (await numberAccount(NUMBER)).id);
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    await disconnectAccount(owner, (await numberAccount(APP_NUMBER)).id);
    expect(
      calls.some(
        (call) => call.method === 'DELETE' && call.url.includes(`/${WABA}/subscribed_apps`),
      ),
    ).toBe(true);
    expect((await numberAccount(NUMBER)).disconnected_at).not.toBeNull();
  });
});
