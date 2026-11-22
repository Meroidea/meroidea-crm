import { createHmac } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { POST as metaWebhook } from '@/app/api/webhooks/meta/route';
import { POST as tiktokWebhook } from '@/app/api/webhooks/tiktok/route';
import { AppError } from '@/lib/errors';
import { anonymizeContact } from '@/modules/contacts/privacy';
import { createContactSchema } from '@/modules/contacts/schemas';
import { createContact } from '@/modules/contacts/service';
import { avatarPath, mediaPath } from '@/modules/social/queries';
import {
  connectAccounts,
  linkConversationContact,
  replyToConversation,
  retryReply,
} from '@/modules/social/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

// Social inbox, second part (ADR-065): real time, saved media, receipts, rate limits, TikTok
// signatures. Meta, TikTok and their media hosts are simulated at the network edge; the
// database, Realtime's message table, Storage, the routes and the services are the real ones.

vi.hoisted(() => {
  process.env.META_APP_ID = 'meta-app-2';
  process.env.META_APP_SECRET = 'meta-secret-2-0123456789abcdef';
  process.env.META_LOGIN_CONFIG_ID = 'config-2';
  process.env.META_WEBHOOK_VERIFY_TOKEN = 'verify-token-2-0123456789';
  process.env.TIKTOK_APP_ID = 'tiktok-app-2';
  process.env.TIKTOK_APP_SECRET = 'tiktok-secret-2-0123456789';
  process.env.TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/?client_key=tiktok-app-2';
});

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;
const PAGE = `rt-page-${stamp}`;
const IG = `rt-ig-${stamp}`;
const TT = `rt-tt-${stamp}`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

let tenantId: string;
let otherTenant: string;
const users: string[] = [];
const otherUsers: string[] = [];
let owner: TenantContext;
let manager: TenantContext;
let staff: TenantContext;
let outsider: TenantContext;

type Call = { method: string; url: string; body: string };
const calls: Call[] = [];
const realFetch = globalThis.fetch;
type Handler = (call: Call) => unknown | Promise<unknown>;
let routes: [RegExp, Handler][] = [];
const route = (method: string, pattern: RegExp, handler: Handler) =>
  routes.unshift([new RegExp(`^${method} ${pattern.source}`), handler]);
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const image = (bytes: Uint8Array = JPEG, type = 'image/jpeg') =>
  new Response(new Blob([new Uint8Array(bytes)]), {
    status: 200,
    headers: { 'content-type': type },
  });

function metaAccounts() {
  route('POST', /https:\/\/graph\.facebook\.com\/v\d+\.\d+\/oauth\/access_token/, () => ({
    access_token: 'SYSTEM_USER_TOKEN_2',
  }));
  route('GET', /.*\/me\?fields=client_business_id/, () => ({ client_business_id: 'biz-2' }));
  route('GET', /.*\/me\/accounts/, () => ({
    data: [
      {
        id: PAGE,
        name: 'Corner Store',
        access_token: 'PAGE_TOKEN_2',
        instagram_business_account: { id: IG, username: 'cornerstore' },
      },
    ],
  }));
  route('GET', /.*\/me\/assigned_instagram_accounts/, () => ({ data: [] }));
  route('POST', /.*\/subscribed_apps/, () => ({ success: true }));
  route('GET', /.*\/conversations\?/, () => ({ data: [] }));
}

beforeAll(async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    // Local Supabase (database API, storage) is real; every https address is simulated.
    if (!url.startsWith('https://')) return realFetch(input, init);
    const call = {
      method: (init?.method ?? 'GET').toUpperCase(),
      url,
      body: typeof init?.body === 'string' ? init.body : '',
    };
    calls.push(call);
    const match = routes.find(([pattern]) => pattern.test(`${call.method} ${url}`));
    if (!match) return json({ error: { message: `no route for ${url}`, code: 1 } }, 400);
    const result = await match[1](call);
    return result instanceof Response ? result : json(result);
  });

  const one = await createWorkspace(`Realtime Co ${stamp}`, mail('rt-owner'));
  tenantId = one.tenantId;
  users.push(one.ownerId);
  const two = await createWorkspace(`Realtime Other ${stamp}`, mail('rt-other'));
  otherTenant = two.tenantId;
  otherUsers.push(two.ownerId);
  const managerId = await addMember(tenantId, mail('rt-manager'), 'Mel Manager', 'manager');
  const staffId = await addMember(tenantId, mail('rt-staff'), 'Sol Staff', 'member');
  users.push(managerId, staffId);
  owner = await contextFor(one.ownerId, tenantId);
  manager = await contextFor(managerId, tenantId);
  staff = await contextFor(staffId, tenantId);
  outsider = await contextFor(two.ownerId, otherTenant);

  metaAccounts();
  await connectAccounts(owner, 'meta', 'CODE', 'http://localhost:3000/api/social/oauth/meta');
  routes = [];
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
  const objects = (await adminDb().execute(sql`
    select name from storage.objects where bucket_id = 'social-media'
      and (left(name, 36) = ${tenantId} or left(name, 36) = ${otherTenant})`)) as unknown as {
    name: string;
  }[];
  if (objects.length > 0) {
    const { removeSocialMedia } = await import('@/server/storage');
    await removeSocialMedia(objects.map((object) => object.name));
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
  return error as AppError;
}

const rows = async <T>(query: ReturnType<typeof sql>) =>
  (await adminDb().execute(query)) as unknown as T[];

function signedMeta(body: unknown) {
  const raw = JSON.stringify(body);
  return new Request('http://localhost:3000/api/webhooks/meta', {
    method: 'POST',
    headers: {
      'x-hub-signature-256': `sha256=${createHmac('sha256', process.env.META_APP_SECRET!).update(raw).digest('hex')}`,
    },
    body: raw,
  });
}

function messaging(object: 'page' | 'instagram', account: string, item: Record<string, unknown>) {
  return { object, entry: [{ id: account, time: Date.now(), messaging: [item] }] };
}

const inbound = (
  object: 'page' | 'instagram',
  account: string,
  participant: string,
  mid: string,
  message: Record<string, unknown>,
) =>
  messaging(object, account, {
    sender: { id: participant },
    recipient: { id: account },
    timestamp: Date.now(),
    message: { mid, ...message },
  });

async function message(externalId: string) {
  const [row] = await rows<{
    id: string;
    status: string;
    attachments: Record<string, unknown>[];
    conversation_id: string;
  }>(
    sql`select id, status, attachments, conversation_id from social_messages where external_id = ${externalId}`,
  );
  return row!;
}

async function conversationWith(participant: string) {
  const [row] = await rows<{ id: string }>(sql`
    select id from social_conversations where tenant_id = ${tenantId} and participant_id = ${participant}`);
  return row!;
}

async function storedObject(path: string): Promise<boolean> {
  const [row] = await rows<{ n: number }>(sql`
    select count(*)::int as n from storage.objects where bucket_id = 'social-media' and name = ${path}`);
  return (row?.n ?? 0) === 1;
}

/** What Realtime would let this person receive on a topic: RLS on realtime.messages. */
async function channelRows(ctx: TenantContext, topic: string): Promise<number> {
  const result = (await withRls(ctx, async (tx) => {
    await tx.execute(sql`select set_config('realtime.topic', ${topic}, true)`);
    return tx.execute(sql`select count(*)::int as n from realtime.messages where topic = ${topic}`);
  })) as unknown as { n: number }[];
  return result[0]?.n ?? -1;
}

/* ------------------------------------------------------------------------------ tests */

describe('real time', () => {
  it('announces a new message on the business’s private channel, with only its conversation id', async () => {
    const body = inbound('page', PAGE, 'PSID-RT', `m_rt_${stamp}`, {
      text: 'Is the shop open late?',
    });
    expect((await metaWebhook(signedMeta(body))).status).toBe(200);
    const conversation = await conversationWith('PSID-RT');
    const broadcasts = await rows<{
      payload: Record<string, unknown>;
      event: string;
      private: boolean;
    }>(sql`
      select payload, event, private from realtime.messages
      where topic = ${`social:${tenantId}`} and payload ->> 'conversationId' = ${conversation.id}`);
    expect(broadcasts.length).toBeGreaterThan(0);
    for (const broadcast of broadcasts) {
      expect(broadcast).toMatchObject({ event: 'changed', private: true });
      expect(Object.keys(broadcast.payload).sort()).toEqual(['conversationId', 'id']);
      expect(JSON.stringify(broadcast.payload)).not.toContain('open late');
    }
  });

  it('lets only people who may read the inbox join the channel', async () => {
    const topic = `social:${tenantId}`;
    expect(await channelRows(owner, topic)).toBeGreaterThan(0);
    expect(await channelRows(manager, topic)).toBeGreaterThan(0);
    expect(await channelRows(staff, topic)).toBe(0);
    expect(await channelRows(outsider, topic)).toBe(0);
    expect(await channelRows(owner, 'social:not-a-business')).toBe(0);
  });

  it('closes the channel while the feature is switched off', async () => {
    await adminDb().execute(
      // Both inbox features (ADR-070): with either on, the inbox's permissions stay.
      sql`update tenants set features = array_remove(array_remove(array_remove(features, 'social'), 'email_channel'), 'live_chat') where id = ${tenantId}`,
    );
    try {
      expect(await channelRows(owner, `social:${tenantId}`)).toBe(0);
    } finally {
      await adminDb().execute(
        sql`update tenants set features = features || array['social', 'email_channel', 'live_chat'] where id = ${tenantId}`,
      );
    }
  });
});

describe('saved media', () => {
  it('copies a photo into private storage, and serves it only to people who may read it', async () => {
    route('GET', /https:\/\/scontent\.xx\.fbcdn\.net\/v\/photo\.jpg/, () => image());
    const body = inbound('page', PAGE, 'PSID-MEDIA', `m_photo_${stamp}`, {
      attachments: [
        { type: 'image', payload: { url: 'https://scontent.xx.fbcdn.net/v/photo.jpg?oe=1' } },
      ],
    });
    expect((await metaWebhook(signedMeta(body))).status).toBe(200);
    const stored = await message(`m_photo_${stamp}`);
    const [attachment] = stored.attachments;
    expect(attachment).toMatchObject({
      type: 'image',
      state: 'stored',
      mimeType: 'image/jpeg',
      size: JPEG.length,
    });
    expect(attachment).not.toHaveProperty('url');
    const path = attachment!.storagePath as string;
    expect(path.startsWith(`${tenantId}/social/${stored.conversation_id}/${stored.id}/`)).toBe(
      true,
    );
    expect(await storedObject(path)).toBe(true);

    expect(await mediaPath(owner, stored.id, 0)).toBe(path);
    expect(await mediaPath(outsider, stored.id, 0)).toBeNull();
    await expectCode(() => mediaPath(staff, stored.id, 0), 'FORBIDDEN');
  });

  it('never fetches from a host outside the platforms’, and refuses a page dressed as a photo', async () => {
    route('GET', /https:\/\/scontent\.xx\.fbcdn\.net\/v\/fake\.jpg/, () =>
      image(new TextEncoder().encode('<html>not a photo</html>')),
    );
    const before = calls.length;
    const body = inbound('page', PAGE, 'PSID-MEDIA', `m_bad_${stamp}`, {
      attachments: [
        { type: 'image', payload: { url: 'https://evil.example.com/steal.jpg' } },
        { type: 'image', payload: { url: 'https://scontent.xx.fbcdn.net/v/fake.jpg' } },
      ],
    });
    expect((await metaWebhook(signedMeta(body))).status).toBe(200);
    const stored = await message(`m_bad_${stamp}`);
    expect(stored.attachments.map((attachment) => attachment.state)).toEqual(['failed', 'skipped']);
    expect(calls.slice(before).some((call) => call.url.includes('evil.example.com'))).toBe(false);
  });

  it('saves a new customer’s picture', async () => {
    route('GET', /.*\/PSID-PIC\?fields=/, () => ({
      first_name: 'Pat',
      last_name: 'Picture',
      profile_pic: 'https://scontent.xx.fbcdn.net/v/pic.jpg',
    }));
    route('GET', /https:\/\/scontent\.xx\.fbcdn\.net\/v\/pic\.jpg/, () => image());
    const body = inbound('page', PAGE, 'PSID-PIC', `m_pic_${stamp}`, { text: 'Hello' });
    expect((await metaWebhook(signedMeta(body))).status).toBe(200);
    const conversation = await conversationWith('PSID-PIC');
    const path = await avatarPath(owner, conversation.id);
    expect(path).toMatch(new RegExp(`^${tenantId}/social/avatars/`));
    expect(await storedObject(path!)).toBe(true);
    expect(await avatarPath(outsider, conversation.id)).toBeNull();
  });
});

describe('receipts', () => {
  it('move a reply to delivered, then read, and never back', async () => {
    const conversation = await conversationWith('PSID-RT');
    route('POST', new RegExp(`.*/${PAGE}/messages`), () => ({ message_id: `m_reply_rt_${stamp}` }));
    await replyToConversation(manager, { conversationId: conversation.id, body: 'Until 9pm' });
    expect((await message(`m_reply_rt_${stamp}`)).status).toBe('sent');

    const delivered = messaging('page', PAGE, {
      sender: { id: 'PSID-RT' },
      recipient: { id: PAGE },
      delivery: { mids: [`m_reply_rt_${stamp}`], watermark: Date.now() },
    });
    await metaWebhook(signedMeta(delivered));
    expect((await message(`m_reply_rt_${stamp}`)).status).toBe('delivered');

    const read = messaging('page', PAGE, {
      sender: { id: 'PSID-RT' },
      recipient: { id: PAGE },
      timestamp: Date.now(),
      read: { watermark: Date.now() + 1000 },
    });
    await metaWebhook(signedMeta(read));
    expect((await message(`m_reply_rt_${stamp}`)).status).toBe('read');

    await metaWebhook(signedMeta(delivered));
    expect((await message(`m_reply_rt_${stamp}`)).status).toBe('read');
  });

  it('Instagram’s seen marks that reply read', async () => {
    const first = inbound('instagram', IG, 'IGSID-RT', `ig_in_${stamp}`, { text: 'Hi!' });
    await metaWebhook(signedMeta(first));
    const conversation = await conversationWith('IGSID-RT');
    route('POST', new RegExp(`.*/${IG}/messages`), () => ({ message_id: `ig_reply_${stamp}` }));
    await replyToConversation(manager, { conversationId: conversation.id, body: 'Hello there' });
    const seen = messaging('instagram', IG, {
      sender: { id: 'IGSID-RT' },
      recipient: { id: IG },
      timestamp: Date.now(),
      read: { mid: `ig_reply_${stamp}` },
    });
    await metaWebhook(signedMeta(seen));
    expect((await message(`ig_reply_${stamp}`)).status).toBe('read');
  });
});

describe('rate limits', () => {
  it('says how long to wait, keeps the reply for Retry, and Retry sends the same message', async () => {
    const conversation = await conversationWith('PSID-RT');
    route('POST', new RegExp(`.*/${PAGE}/messages`), () =>
      json({ error: { message: '(#80006) There have been too many messages', code: 80006 } }, 400, {
        'x-business-use-case-usage': JSON.stringify({
          'biz-2': [{ type: 'messenger', estimated_time_to_regain_access: 3 }],
        }),
      }),
    );
    const error = await expectCode(
      () =>
        replyToConversation(manager, { conversationId: conversation.id, body: 'Throttled reply' }),
      'RATE_LIMITED',
    );
    expect(error.message).toContain('about 3 minutes');
    const [failed] = await rows<{ id: string; status: string }>(sql`
      select id, status from social_messages where conversation_id = ${conversation.id} and body = 'Throttled reply'`);
    expect(failed?.status).toBe('failed');
    const [account] = await rows<{ status: string }>(sql`
      select status from social_accounts where tenant_id = ${tenantId} and platform = 'facebook'`);
    expect(account?.status).toBe('active');

    route('POST', new RegExp(`.*/${PAGE}/messages`), () => ({ message_id: `m_retried_${stamp}` }));
    await retryReply(manager, failed!.id);
    const retried = await rows<{ id: string; status: string; external_id: string }>(sql`
      select id, status, external_id from social_messages where conversation_id = ${conversation.id} and body = 'Throttled reply'`);
    expect(retried).toEqual([
      { id: failed!.id, status: 'sent', external_id: `m_retried_${stamp}` },
    ]);
    await expectCode(() => retryReply(manager, failed!.id), 'NOT_FOUND');
  });
});

describe('TikTok', () => {
  const sign = (raw: string, secret = process.env.TIKTOK_APP_SECRET!) => {
    const t = Math.floor(Date.now() / 1000);
    return `t=${t},s=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
  };
  const notify = (payload: Record<string, unknown>, signature?: string) => {
    const raw = JSON.stringify({
      client_key: 'tiktok-app-2',
      create_time: 1,
      user_openid: TT,
      ...payload,
    });
    return tiktokWebhook(
      new Request('http://localhost:3000/api/webhooks/tiktok', {
        method: 'POST',
        headers:
          signature === undefined
            ? {}
            : { 'tiktok-signature': signature === 'sign' ? sign(raw) : signature },
        body: raw,
      }),
    );
  };
  const photo = {
    sender: 'kim.k',
    message_id: `tt_photo_${stamp}`,
    timestamp: Date.now() - 1000,
    message_type: 'IMAGE',
    image: { media_id: 'media-1' },
  };

  beforeAll(async () => {
    route('POST', /.*\/tt_user\/oauth2\/token\//, () => ({
      code: 0,
      data: {
        open_id: TT,
        access_token: 'TT_ACCESS_2',
        expires_in: 86_400,
        refresh_token: 'TT_REFRESH_2',
        refresh_token_expires_in: 31_536_000,
      },
    }));
    route('GET', /.*\/business\/get\//, () => ({ code: 0, data: { username: 'cornerstore' } }));
    route('GET', /.*\/conversation\/list\//, () => ({ code: 0, data: { conversations: [] } }));
    await connectAccounts(owner, 'tiktok', 'TT', 'http://localhost:3000/api/social/oauth/tiktok');
    routes = [];
  });

  it('fetches a photo by its media id and saves it', async () => {
    route('GET', /.*\/business\/message\/content\/list\//, () => ({
      code: 0,
      data: { messages: [photo] },
    }));
    route('POST', /.*\/business\/message\/media\/download\//, (call) => {
      expect(JSON.parse(call.body)).toMatchObject({
        business_id: TT,
        conversation_id: 'tt-conv-1',
        message_id: `tt_photo_${stamp}`,
        media_id: 'media-1',
        media_type: 'IMAGE',
      });
      return { code: 0, data: { download_url: 'https://p16.tiktokcdn.com/obj/photo' } };
    });
    route('GET', /https:\/\/p16\.tiktokcdn\.com\/obj\/photo/, () => image());
    expect(
      (
        await notify(
          { event: 'im_receive_msg', content: JSON.stringify({ conversation_id: 'tt-conv-1' }) },
          'sign',
        )
      ).status,
    ).toBe(200);
    const stored = await message(`tt_photo_${stamp}`);
    expect(stored.attachments[0]).toMatchObject({
      type: 'image',
      state: 'stored',
      mimeType: 'image/jpeg',
    });
  });

  it('throttles unsigned notifications, but not signed ones', async () => {
    let reads = 0;
    route('GET', /.*\/business\/message\/content\/list\//, () => {
      reads += 1;
      return { code: 0, data: { messages: [] } };
    });
    const content = JSON.stringify({ conversation_id: 'tt-conv-throttle' });
    for (let i = 0; i < 8; i += 1) await notify({ event: 'im_receive_msg', content });
    expect(reads).toBe(6);
    await notify({ event: 'im_receive_msg', content }, 'sign');
    expect(reads).toBe(7);
    // A signature that does not match is treated as no signature: still throttled.
    await notify({ event: 'im_receive_msg', content }, `t=${Math.floor(Date.now() / 1000)},s=00`);
    expect(reads).toBe(7);
  });

  it('applies a read receipt only when signed', async () => {
    const conversation = await conversationWith('tt-conv-1');
    route('POST', /.*\/business\/message\/send\//, () => ({
      code: 0,
      data: { message: { message_id: `tt_reply_${stamp}` } },
    }));
    await replyToConversation(manager, { conversationId: conversation.id, body: 'Lovely photo!' });
    const receipt = {
      event: 'im_mark_read_msg',
      content: JSON.stringify({
        conversation_id: 'tt-conv-1',
        read: { last_read_timestamp: Date.now() + 1000 },
      }),
    };
    await notify(receipt);
    expect((await message(`tt_reply_${stamp}`)).status).toBe('sent');
    await notify(receipt, 'sign');
    expect((await message(`tt_reply_${stamp}`)).status).toBe('read');
  });

  it('treats throttling as throttling, not as a broken connection', async () => {
    const conversation = await conversationWith('tt-conv-1');
    route('POST', /.*\/business\/message\/send\//, () => ({
      code: 40100,
      message: 'Requests made too frequently.',
    }));
    await expectCode(
      () => replyToConversation(manager, { conversationId: conversation.id, body: 'Too fast' }),
      'RATE_LIMITED',
    );
    const [account] = await rows<{ status: string }>(sql`
      select status from social_accounts where tenant_id = ${tenantId} and platform = 'tiktok'`);
    expect(account?.status).toBe('active');
  });
});

describe('erasing a person', () => {
  it('blanks what they sent, deletes their saved media and picture, and keeps the business’s replies', async () => {
    const conversation = await conversationWith('PSID-MEDIA');
    const stored = await message(`m_photo_${stamp}`);
    const path = stored.attachments[0]!.storagePath as string;
    expect(await storedObject(path)).toBe(true);
    route('POST', new RegExp(`.*/${PAGE}/messages`), () => ({ message_id: `m_kept_${stamp}` }));
    await replyToConversation(owner, {
      conversationId: conversation.id,
      body: 'Thanks for the photo',
    });
    const contact = await createContact(
      owner,
      createContactSchema.parse({ firstName: 'Erin', lastName: 'Erased', confirmDuplicate: true }),
    );
    await linkConversationContact(owner, {
      conversationId: conversation.id,
      contactId: contact.id,
    });

    await anonymizeContact(owner, contact.id);

    const messages = await rows<{
      direction: string;
      body: string | null;
      attachments: unknown[];
    }>(sql`
      select direction, body, attachments from social_messages where conversation_id = ${conversation.id}`);
    for (const row of messages.filter((item) => item.direction === 'inbound')) {
      expect(row).toMatchObject({ body: 'Erased on request', attachments: [] });
    }
    expect(messages.some((row) => row.body === 'Thanks for the photo')).toBe(true);
    const [after] = await rows<{
      participant_name: string;
      participant_avatar_path: string | null;
    }>(sql`
      select participant_name, participant_avatar_path from social_conversations where id = ${conversation.id}`);
    expect(after).toEqual({ participant_name: 'Erased', participant_avatar_path: null });
    expect(await storedObject(path)).toBe(false);
  });
});
