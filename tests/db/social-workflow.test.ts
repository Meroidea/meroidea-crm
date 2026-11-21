import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { socialAccounts } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { storeCredentials } from '@/modules/social/credentials';
import { listConversations } from '@/modules/social/queries';
import {
  assignConversation,
  markConversationRead,
  replyToConversation,
  retryReply,
  sendMediaReply,
  setConversationStatus,
  snoozeConversation,
  startMediaUpload,
} from '@/modules/social/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';
import { readSocialMedia, writeSocialMedia } from '@/server/storage';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

// The inbox's workflow and media (ADR-067): assigning, snoozing, search, the reply window's own
// error, photos and files in replies, and read receipts. The platforms are simulated at the
// network edge; the database, storage, row-level security and services are the real ones.

vi.hoisted(() => {
  process.env.META_APP_ID = 'meta-app-1';
  process.env.META_APP_SECRET = 'meta-secret-0123456789abcdef';
  process.env.TIKTOK_APP_ID = 'tiktok-app-1';
  process.env.TIKTOK_APP_SECRET = 'tiktok-secret-0123456789';
});

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const HTML = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');
const WA_NUMBER = `5${stamp}`;
const PAGE = `page-wf-${stamp}`;
const TT = `tt-wf-${stamp}`;
const CUSTOMER = `61400${String(stamp).slice(-6)}`;

let tenantId: string;
let otherTenant: string;
const users: string[] = [];
const otherUsers: string[] = [];
let owner: TenantContext;
let manager: TenantContext;
let staff: TenantContext;
let outsider: TenantContext;
const conversations: Record<'whatsapp' | 'facebook' | 'tiktok', string> = {
  whatsapp: '',
  facebook: '',
  tiktok: '',
};

/* ------------------------------------------------------------------ simulated platforms */

type Call = { method: string; url: string; body: string; form: Record<string, string> };
const calls: Call[] = [];
const realFetch = globalThis.fetch;
type Handler = (call: Call) => unknown;
let routes: [RegExp, Handler][] = [];
const route = (method: string, pattern: RegExp, handler: Handler) =>
  routes.unshift([new RegExp(`^${method} ${pattern.source}`), handler]);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let sent = 0;
function platformsAnswer() {
  route('POST', new RegExp(`.*/${WA_NUMBER}/media`), () => json({ id: `wa-media-${stamp}` }));
  route('POST', new RegExp(`.*/${WA_NUMBER}/messages`), (call) => {
    if (call.body.includes('"status":"read"')) return json({ success: true });
    sent += 1;
    return json({ messages: [{ id: `wamid.WF${stamp}.${sent}` }] });
  });
  route('POST', new RegExp(`.*/${PAGE}/messages`), (call) => {
    if (call.body.includes('sender_action')) return json({ recipient_id: 'PSID-WF' });
    sent += 1;
    return json({ message_id: `m_wf_${stamp}_${sent}` });
  });
  route('POST', /.*\/business\/message\/media\/upload\//, () =>
    json({ code: 0, message: 'OK', data: { media_id: `tt-media-${stamp}` } }),
  );
  route('POST', /.*\/business\/message\/send\//, () => {
    sent += 1;
    return json({ code: 0, message: 'OK', data: { message: { message_id: `tt-msg-${sent}` } } });
  });
}

beforeAll(async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!/^https:\/\/(graph\.facebook\.com|business-api\.tiktok\.com)\//.test(url)) {
      return realFetch(input, init);
    }
    const form: Record<string, string> = {};
    if (init?.body instanceof FormData) {
      for (const [key, value] of init.body.entries()) {
        form[key] = typeof value === 'string' ? value : `file:${value.type}:${value.size}`;
      }
    }
    const call = {
      method: (init?.method ?? 'GET').toUpperCase(),
      url,
      body: typeof init?.body === 'string' ? init.body : '',
      form,
    };
    calls.push(call);
    const match = routes.find(([pattern]) => pattern.test(`${call.method} ${url}`));
    if (!match)
      return json({ error: { message: `no route for ${call.method} ${url}`, code: 1 } }, 400);
    const result = match[1](call);
    return result instanceof Response ? result : json(result);
  });

  const one = await createWorkspace(`Workflow Co ${stamp}`, mail('wf-owner'));
  tenantId = one.tenantId;
  users.push(one.ownerId);
  const two = await createWorkspace(`Workflow Other ${stamp}`, mail('wf-other'));
  otherTenant = two.tenantId;
  otherUsers.push(two.ownerId);
  const managerId = await addMember(tenantId, mail('wf-manager'), 'Morgan Manager', 'manager');
  const staffId = await addMember(tenantId, mail('wf-staff'), 'Sky Staff', 'member');
  users.push(managerId, staffId);
  owner = await contextFor(one.ownerId, tenantId);
  manager = await contextFor(managerId, tenantId);
  staff = await contextFor(staffId, tenantId);
  outsider = await contextFor(two.ownerId, otherTenant);

  // One connected account per platform, each with a customer who wrote an hour ago.
  for (const [platform, externalId, participant] of [
    ['whatsapp', WA_NUMBER, CUSTOMER],
    ['facebook', PAGE, 'PSID-WF'],
    ['tiktok', TT, 'conv-wf'],
  ] as const) {
    const accountId = await withRls(owner, async (tx) => {
      const [row] = await tx
        .insert(socialAccounts)
        .values({
          tenantId,
          platform,
          externalId,
          name: `${platform} account`,
          connectedBy: owner.userId,
        })
        .returning({ id: socialAccounts.id });
      await storeCredentials(tx, tenantId, row!.id, {
        accessToken: `${platform.toUpperCase()}_TOKEN`,
        accessExpiresAt: platform === 'tiktok' ? new Date(Date.now() + 86_400_000) : null,
        refreshToken: platform === 'tiktok' ? 'TT_REFRESH' : null,
        refreshExpiresAt: null,
      });
      return row!.id;
    });
    const [conversation] = (await adminDb().execute(sql`
      insert into social_conversations (tenant_id, account_id, external_id, participant_id,
        participant_name, participant_phone, last_message_at, last_inbound_at, unread_count)
      values (${tenantId}, ${accountId}, ${platform === 'tiktok' ? participant : null}, ${participant},
        ${platform === 'whatsapp' ? 'Jamie Customer' : `${platform} customer`},
        ${platform === 'whatsapp' ? CUSTOMER : null}, now() - interval '1 hour',
        now() - interval '1 hour', 1)
      returning id`)) as unknown as { id: string }[];
    conversations[platform] = conversation!.id;
    await adminDb().execute(sql`
      insert into social_messages (tenant_id, conversation_id, account_id, external_id, direction,
        body, sent_at, status)
      values (${tenantId}, ${conversation!.id}, ${accountId}, ${`in-${platform}-${stamp}`},
        'inbound', ${platform === 'whatsapp' ? 'Do you have gluten free pizza?' : 'Hello there'},
        now() - interval '1 hour', 'received')`);
  }
});

afterEach(() => {
  routes = [];
});

afterAll(async () => {
  vi.restoreAllMocks();
  for (const name of ['META_APP_ID', 'META_APP_SECRET', 'TIKTOK_APP_ID', 'TIKTOK_APP_SECRET']) {
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

const rows = async <T>(query: ReturnType<typeof sql>) =>
  (await adminDb().execute(query)) as unknown as T[];

const ids = async (ctx: TenantContext, filters: Parameters<typeof listConversations>[1]) =>
  (await listConversations(ctx, filters)).rows.map((row) => row.id);

async function uploaded(
  ctx: TenantContext,
  platform: keyof typeof conversations,
  bytes: Uint8Array,
  mimeType = 'image/jpeg',
) {
  const ticket = await startMediaUpload(ctx, {
    conversationId: conversations[platform],
    fileName: 'photo.jpg',
    mimeType,
    size: bytes.byteLength,
  });
  // What the browser does with the ticket: put the bytes at the server's chosen path.
  await writeSocialMedia(ticket.path, bytes, mimeType);
  return ticket.path;
}

/* ------------------------------------------------------------------------------ tests */

describe('assigning a conversation', () => {
  it('a replier gives it to a colleague who can read the inbox, who is told; it is audited', async () => {
    const id = conversations.whatsapp;
    await assignConversation(owner, { conversationId: id, userId: manager.userId });
    const [row] = await rows<{ assigned_user_id: string }>(sql`
      select assigned_user_id from social_conversations where id = ${id}`);
    expect(row?.assigned_user_id).toBe(manager.userId);
    const notices = await rows<{ type: string; url: string }>(sql`
      select type, url from notifications where tenant_id = ${tenantId} and user_id = ${manager.userId}
        and type = 'conversation_assigned'`);
    expect(notices).toEqual([{ type: 'conversation_assigned', url: `/social/${id}` }]);
    const audited = await rows<{ n: number }>(sql`
      select count(*)::int as n from audit_logs where tenant_id = ${tenantId}
        and entity_type = 'social_conversation' and entity_id = ${id}
        and changes ? 'assignedUserId'`);
    expect(audited[0]?.n).toBe(1);

    expect(await ids(manager, { view: 'mine' })).toEqual([id]);
    expect(await ids(owner, { view: 'mine' })).toEqual([]);
  });

  it('refuses a colleague without the inbox, someone from another business, and people who cannot reply', async () => {
    const id = conversations.facebook;
    await expectCode(
      () => assignConversation(owner, { conversationId: id, userId: staff.userId }),
      'VALIDATION',
    );
    await expectCode(
      () => assignConversation(owner, { conversationId: id, userId: outsider.userId }),
      'VALIDATION',
    );
    await expectCode(
      () => assignConversation(staff, { conversationId: id, userId: null }),
      'FORBIDDEN',
    );
    // Another business cannot reach the conversation at all.
    await expectCode(
      () => assignConversation(outsider, { conversationId: id, userId: null }),
      'NOT_FOUND',
    );
  });
});

describe('snoozing', () => {
  it('a snoozed conversation leaves Open, waits in Snoozed, and the customer writing brings it back', async () => {
    const id = conversations.facebook;
    await expectCode(
      () =>
        snoozeConversation(owner, {
          conversationId: id,
          until: new Date(Date.now() - 60_000).toISOString(),
        }),
      'VALIDATION',
    );
    await snoozeConversation(owner, {
      conversationId: id,
      until: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(await ids(owner, { view: 'open' })).not.toContain(id);
    expect(await ids(owner, { view: 'snoozed' })).toContain(id);

    // The time passing brings it back without anyone doing anything.
    await adminDb().execute(sql`
      update social_conversations set snoozed_until = now() - interval '1 minute' where id = ${id}`);
    expect(await ids(owner, { view: 'open' })).toContain(id);
    expect(await ids(owner, { view: 'snoozed' })).not.toContain(id);

    await snoozeConversation(owner, {
      conversationId: id,
      until: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const { recordMessage } = await import('@/modules/social/ingest');
    const [account] = await rows<{ account_id: string }>(sql`
      select account_id from social_conversations where id = ${id}`);
    await adminDb().transaction((tx) =>
      recordMessage(
        tx,
        { tenantId, accountId: account!.account_id, conversationId: id },
        {
          externalId: `wake-${stamp}`,
          direction: 'inbound',
          body: 'Still there?',
          attachments: [],
          sentAt: new Date(),
        },
        { countUnread: true },
      ),
    );
    const [woken] = await rows<{ status: string; snoozed_until: string | null }>(sql`
      select status, snoozed_until from social_conversations where id = ${id}`);
    expect(woken).toEqual({ status: 'open', snoozed_until: null });

    await snoozeConversation(owner, {
      conversationId: id,
      until: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await setConversationStatus(owner, { conversationId: id, status: 'done' });
    const [done] = await rows<{ status: string; snoozed_until: string | null }>(sql`
      select status, snoozed_until from social_conversations where id = ${id}`);
    expect(done).toEqual({ status: 'done', snoozed_until: null });
    await setConversationStatus(owner, { conversationId: id, status: 'open' });
  });
});

describe('searching the inbox', () => {
  it('finds a customer by name, number or what was said, and only in this business', async () => {
    const wa = conversations.whatsapp;
    expect(await ids(owner, { view: 'all', q: 'jamie' })).toEqual([wa]);
    expect(await ids(owner, { view: 'all', q: CUSTOMER.slice(3, 10) })).toEqual([wa]);
    expect(await ids(owner, { view: 'all', q: 'gluten free' })).toEqual([wa]);
    expect(await ids(owner, { view: 'all', q: 'no such words' })).toEqual([]);
    // A % typed into the box is a percent sign, not "anything".
    expect(await ids(owner, { view: 'all', q: '%' })).toEqual([]);
    await expectCode(
      () =>
        listConversations(outsider, { view: 'all', q: 'jamie' }).then((r) => {
          if (r.rows.length > 0) throw new Error('leaked');
          throw new AppError('NOT_FOUND', 'none');
        }),
      'NOT_FOUND',
    );
  });
});

describe('the reply window', () => {
  it('free text after the window closes is refused with WINDOW_EXPIRED', async () => {
    const id = conversations.tiktok;
    await adminDb().execute(sql`
      update social_conversations set last_inbound_at = now() - interval '3 days' where id = ${id}`);
    await expectCode(
      () => replyToConversation(manager, { conversationId: id, body: 'Hello?' }),
      'WINDOW_EXPIRED',
    );
    await adminDb().execute(sql`
      update social_conversations set last_inbound_at = now() - interval '1 hour' where id = ${id}`);
  });
});

describe('photos and files in replies', () => {
  it('WhatsApp: uploaded to WhatsApp, then sent by id with its caption', async () => {
    platformsAnswer();
    calls.length = 0;
    const path = await uploaded(manager, 'whatsapp', JPEG);
    expect(path.startsWith(`${tenantId}/social/${conversations.whatsapp}/outbound/`)).toBe(true);
    const { messageId } = await sendMediaReply(manager, {
      conversationId: conversations.whatsapp,
      path,
      mimeType: 'image/jpeg',
      fileName: 'photo.jpg',
      caption: 'Here is the menu',
    });
    const upload = calls.find((call) => call.url.endsWith(`/${WA_NUMBER}/media`));
    expect(upload?.form).toMatchObject({ messaging_product: 'whatsapp', type: 'image/jpeg' });
    expect(upload?.form.file).toMatch(/^file:image\/jpeg:/);
    const send = calls.find((call) => call.url.endsWith(`/${WA_NUMBER}/messages`));
    expect(JSON.parse(send!.body)).toMatchObject({
      to: `+${CUSTOMER}`,
      type: 'image',
      image: { id: `wa-media-${stamp}`, caption: 'Here is the menu' },
    });
    const [stored] = await rows<{
      status: string;
      body: string;
      attachments: { state: string; mimeType: string }[];
    }>(sql`
      select status, body, attachments from social_messages where id = ${messageId}`);
    expect(stored).toMatchObject({ status: 'sent', body: 'Here is the menu' });
    expect(stored?.attachments[0]).toMatchObject({ state: 'stored', mimeType: 'image/jpeg' });
  });

  it('Messenger: sent by a short-lived link to private storage', async () => {
    platformsAnswer();
    calls.length = 0;
    const path = await uploaded(manager, 'facebook', JPEG);
    await sendMediaReply(manager, {
      conversationId: conversations.facebook,
      path,
      mimeType: 'image/jpeg',
      fileName: 'photo.jpg',
      caption: null,
    });
    const send = calls.find((call) => call.url.endsWith(`/${PAGE}/messages`));
    const body = JSON.parse(send!.body) as {
      message: { attachment: { type: string; payload: { url: string } } };
    };
    expect(body.message.attachment.type).toBe('image');
    expect(body.message.attachment.payload.url).toContain('/storage/v1/object/sign/social-media/');
  });

  it('TikTok: uploaded as an image, then sent by its media id; words cannot go with it', async () => {
    platformsAnswer();
    calls.length = 0;
    const path = await uploaded(manager, 'tiktok', JPEG);
    await expectCode(
      () =>
        sendMediaReply(manager, {
          conversationId: conversations.tiktok,
          path,
          mimeType: 'image/jpeg',
          fileName: 'photo.jpg',
          caption: 'With words',
        }),
      'VALIDATION',
    );
    await sendMediaReply(manager, {
      conversationId: conversations.tiktok,
      path,
      mimeType: 'image/jpeg',
      fileName: 'photo.jpg',
      caption: null,
    });
    const upload = calls.find((call) => call.url.endsWith('/business/message/media/upload/'));
    expect(upload?.form).toMatchObject({ business_id: TT, media_type: 'IMAGE' });
    const send = calls.find((call) => call.url.endsWith('/business/message/send/'));
    expect(JSON.parse(send!.body)).toMatchObject({
      recipient: { conversation_id: 'conv-wf' },
      message_type: 'IMAGE',
      image: { media_id: `tt-media-${stamp}` },
    });
  });

  it('refuses what the platform does not take, a disguised file (deleted), and someone else’s upload', async () => {
    await expectCode(
      () =>
        startMediaUpload(manager, {
          conversationId: conversations.tiktok,
          fileName: 'menu.pdf',
          mimeType: 'application/pdf',
          size: 1000,
        }),
      'VALIDATION',
    );
    await expectCode(
      () =>
        startMediaUpload(manager, {
          conversationId: conversations.whatsapp,
          fileName: 'huge.jpg',
          mimeType: 'image/jpeg',
          size: 6 * 1024 * 1024,
        }),
      'VALIDATION',
    );
    await expectCode(
      () =>
        startMediaUpload(staff, {
          conversationId: conversations.whatsapp,
          fileName: 'photo.jpg',
          mimeType: 'image/jpeg',
          size: 1000,
        }),
      'FORBIDDEN',
    );

    const disguised = await uploaded(manager, 'whatsapp', HTML);
    await expectCode(
      () =>
        sendMediaReply(manager, {
          conversationId: conversations.whatsapp,
          path: disguised,
          mimeType: 'image/jpeg',
          fileName: 'photo.jpg',
          caption: null,
        }),
      'VALIDATION',
    );
    expect(await readSocialMedia(disguised)).toBeNull();

    // An upload made for one conversation cannot be sent in another.
    const forWhatsApp = await uploaded(manager, 'whatsapp', JPEG);
    await expectCode(
      () =>
        sendMediaReply(manager, {
          conversationId: conversations.facebook,
          path: forWhatsApp,
          mimeType: 'image/jpeg',
          fileName: 'photo.jpg',
          caption: null,
        }),
      'VALIDATION',
    );
  });

  it('a file that failed to send is sent again by Retry', async () => {
    route('POST', new RegExp(`.*/${PAGE}/messages`), () =>
      json({ error: { message: '(#100) The recipient is not available', code: 100 } }, 400),
    );
    const path = await uploaded(manager, 'facebook', JPEG);
    await expectCode(
      () =>
        sendMediaReply(manager, {
          conversationId: conversations.facebook,
          path,
          mimeType: 'image/jpeg',
          fileName: 'photo.jpg',
          caption: null,
        }),
      'CONFLICT',
    );
    const [failed] = await rows<{ id: string; status: string }>(sql`
      select id, status from social_messages where tenant_id = ${tenantId}
        and attachments @> ${JSON.stringify([{ storagePath: path }])}::jsonb`);
    expect(failed?.status).toBe('failed');
    routes = [];
    platformsAnswer();
    calls.length = 0;
    await retryReply(manager, failed!.id);
    const resend = calls.find((call) => call.url.endsWith(`/${PAGE}/messages`));
    expect(JSON.parse(resend!.body)).toMatchObject({ message: { attachment: { type: 'image' } } });
  });
});

describe('read receipts', () => {
  it('opening a conversation with new messages tells WhatsApp and Messenger it was read', async () => {
    platformsAnswer();
    await adminDb().execute(sql`
      update social_conversations set unread_count = 1
      where id in (${conversations.whatsapp}, ${conversations.facebook}, ${conversations.tiktok})`);
    calls.length = 0;
    await markConversationRead(manager, conversations.whatsapp);
    await markConversationRead(manager, conversations.facebook);
    await markConversationRead(manager, conversations.tiktok);
    const read = calls.find(
      (call) =>
        call.url.endsWith(`/${WA_NUMBER}/messages`) && call.body.includes('"status":"read"'),
    );
    expect(JSON.parse(read!.body)).toEqual({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: `in-whatsapp-${stamp}`,
    });
    const seen = calls.find((call) => call.body.includes('sender_action'));
    expect(JSON.parse(seen!.body)).toEqual({
      recipient: { id: 'PSID-WF' },
      sender_action: 'mark_seen',
    });
    // TikTok documents no receipt for businesses: nothing is sent.
    expect(calls.some((call) => call.url.includes('tiktok'))).toBe(false);

    // Opening it again, with nothing new, sends nothing more.
    calls.length = 0;
    await markConversationRead(manager, conversations.whatsapp);
    expect(calls).toEqual([]);
  });
});
