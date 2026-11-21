import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { serverEnv } from '@/server/env';

import { providerFetch, safeReason } from './http';
import {
  ProviderError,
  type AccountRef,
  type DiscoveredAccount,
  type ProviderConversation,
  type ProviderMessage,
} from './types';

/*
 * TikTok Business Messaging API (ADR-064). Open to developers that have passed TikTok's data
 * security and privacy review; not available for accounts signed up in the EEA, Switzerland or
 * the UK, and US accounts need TikTok's extra US review. The account must be a Verified Business
 * Account (or have Advanced Access) and its owner must be over 18. Access tokens last a day and
 * are renewed with a refresh token that lasts a year.
 */

const BASE = 'https://business-api.tiktok.com/open_api/v1.3';

export function tiktokConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.TIKTOK_APP_ID && env.TIKTOK_APP_SECRET && env.TIKTOK_AUTH_URL);
}

function requireTikTok() {
  const env = serverEnv();
  if (!env.TIKTOK_APP_ID || !env.TIKTOK_APP_SECRET || !env.TIKTOK_AUTH_URL) {
    throw new ProviderError('tiktok', 'TikTok is not set up on this platform yet.');
  }
  return { appId: env.TIKTOK_APP_ID, secret: env.TIKTOK_APP_SECRET, authUrl: env.TIKTOK_AUTH_URL };
}

/** The app's account-holder authorisation URL from the TikTok developer portal, with our state. */
export function tiktokAuthorizeUrl(state: string): string {
  const url = new URL(requireTikTok().authUrl);
  url.searchParams.set('state', state);
  return url.toString();
}

/** TikTok answers 200 with `code: 0` on success and a non-zero code on refusal. */
async function tiktokCall(path: string, init: RequestInit & { timeoutMs?: number }) {
  const body = (await providerFetch('tiktok', `${BASE}${path}`, init)) as {
    code?: unknown;
    message?: unknown;
    data?: unknown;
  };
  if (body.code !== 0) {
    const code = typeof body.code === 'number' ? body.code : null;
    // TikTok's Business Messaging return codes: 40100 requests made too frequently (throttled),
    // 40105 invalid or incorrect access token. 40100 is not an authorisation failure.
    const rateLimited = code === 40100;
    throw new ProviderError(
      'tiktok',
      rateLimited
        ? 'TikTok is limiting how often we can call it.'
        : (safeReason(body.message) ?? 'TikTok refused the request.'),
      { reconnect: code === 40105, rateLimited, code },
    );
  }
  return (body.data ?? {}) as Record<string, unknown>;
}

type TokenData = {
  open_id?: unknown;
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  refresh_token_expires_in?: unknown;
};

function tokensFrom(data: TokenData, now = Date.now()) {
  if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') {
    throw new ProviderError('tiktok', 'TikTok did not return the expected tokens.');
  }
  const seconds = (value: unknown, fallback: number) =>
    typeof value === 'number' && value > 0 ? value : fallback;
  return {
    accessToken: data.access_token,
    accessExpiresAt: new Date(now + seconds(data.expires_in, 86_400) * 1000),
    refreshToken: data.refresh_token,
    refreshExpiresAt: new Date(now + seconds(data.refresh_token_expires_in, 31_536_000) * 1000),
  };
}

/** The authorisation code, exchanged for the account's tokens and its business id (open_id). */
export async function exchangeTikTokCode(
  code: string,
  redirectUri: string,
): Promise<DiscoveredAccount> {
  const { appId, secret } = requireTikTok();
  const data = (await tiktokCall('/tt_user/oauth2/token/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: appId,
      client_secret: secret,
      grant_type: 'authorization_code',
      auth_code: code,
      redirect_uri: redirectUri,
    }),
  })) as TokenData;
  if (typeof data.open_id !== 'string' || !data.open_id) {
    throw new ProviderError('tiktok', 'TikTok did not say which account was authorised.');
  }
  const tokens = tokensFrom(data);
  const profile = await fetchTikTokProfile(data.open_id, tokens.accessToken).catch(() => null);
  return {
    platform: 'tiktok',
    externalId: data.open_id,
    name: profile?.name ?? profile?.username ?? 'TikTok account',
    username: profile?.username ?? null,
    avatarUrl: profile?.avatarUrl ?? null,
    providerBusinessId: null,
    ...tokens,
  };
}

/** A fresh access token (and refresh token) for an account whose day-long token has expired. */
export async function refreshTikTokToken(refreshToken: string) {
  const { appId, secret } = requireTikTok();
  const data = (await tiktokCall('/tt_user/oauth2/refresh_token/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: appId,
      client_secret: secret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })) as TokenData;
  return tokensFrom(data);
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : null;

/** The account's name and handle, best effort: connecting works without them. */
async function fetchTikTokProfile(businessId: string, token: string) {
  const query = new URLSearchParams({
    business_id: businessId,
    fields: JSON.stringify(['username', 'display_name', 'profile_image']),
  });
  const data = await tiktokCall(`/business/get/?${query}`, {
    headers: { 'Access-Token': token },
    timeoutMs: 5_000,
  });
  return {
    name: text(data.display_name),
    username: text(data.username),
    avatarUrl: text(data.profile_image),
  };
}

type TikTokMessage = {
  sender?: unknown;
  message_id?: unknown;
  timestamp?: unknown;
  message_type?: unknown;
  text?: { body?: unknown };
  image?: { media_id?: unknown };
  video?: { media_id?: unknown };
  from_user?: { role?: unknown };
};

/** The latest messages of one conversation (TikTok returns at most the 20 most recent). */
export async function fetchTikTokMessages(
  account: AccountRef,
  token: string,
  conversationId: string,
): Promise<{ messages: ProviderMessage[]; customerUsername: string | null }> {
  const query = new URLSearchParams({
    business_id: account.externalId,
    conversation_id: conversationId,
  });
  const data = await tiktokCall(`/business/message/content/list/?${query}`, {
    headers: { 'Access-Token': token },
  });
  const messages: ProviderMessage[] = [];
  let customerUsername: string | null = null;
  for (const message of ((data.messages as TikTokMessage[] | undefined) ?? []).slice(0, 50)) {
    const id = text(message.message_id);
    if (!id || typeof message.timestamp !== 'number') continue;
    const sender = text(message.sender);
    const fromBusiness =
      message.from_user?.role === 'business_account' ||
      (account.username !== null && sender === account.username);
    if (!fromBusiness && sender) customerUsername = sender;
    const type =
      typeof message.message_type === 'string' ? message.message_type.toLowerCase() : 'other';
    // Images and videos are fetched later by their media id (/business/message/media/download/).
    const mediaId = text(message.image?.media_id) ?? text(message.video?.media_id);
    messages.push({
      externalId: id,
      direction: fromBusiness ? 'outbound' : 'inbound',
      body: type === 'text' && typeof message.text?.body === 'string' ? message.text.body : null,
      attachments: type === 'text' ? [] : [mediaId ? { type, mediaId } : { type }],
      sentAt: new Date(message.timestamp),
    });
  }
  return { messages, customerUsername };
}

/**
 * A short-lived download address for an image or video in a message (valid 24 hours), from
 * /business/message/media/download/.
 */
export async function tiktokMediaUrl(
  account: AccountRef,
  token: string,
  conversationId: string,
  messageId: string,
  mediaId: string,
  mediaType: 'IMAGE' | 'VIDEO',
): Promise<string> {
  const data = await tiktokCall('/business/message/media/download/', {
    method: 'POST',
    headers: { 'Access-Token': token, 'content-type': 'application/json' },
    body: JSON.stringify({
      business_id: account.externalId,
      conversation_id: conversationId,
      message_id: messageId,
      media_id: mediaId,
      media_type: mediaType,
    }),
  });
  const url = text(data.download_url);
  if (!url) throw new ProviderError('tiktok', 'TikTok did not return a download address.');
  return url;
}

/** Recent conversations (TikTok keeps 90 days), with each one's latest messages. */
export async function fetchTikTokConversations(
  account: AccountRef,
  token: string,
  limit = 25,
): Promise<ProviderConversation[]> {
  const conversations: ProviderConversation[] = [];
  for (const type of ['SINGLE', 'STRANGER']) {
    const query = new URLSearchParams({
      business_id: account.externalId,
      conversation_type: type,
      limit: String(limit),
    });
    const data = await tiktokCall(`/business/message/conversation/list/?${query}`, {
      headers: { 'Access-Token': token },
    });
    for (const item of ((data.conversations as { conversation_id?: unknown }[]) ?? []).slice(
      0,
      limit,
    )) {
      const conversationId = text(item.conversation_id);
      if (!conversationId || conversations.length >= limit) continue;
      const { messages, customerUsername } = await fetchTikTokMessages(
        account,
        token,
        conversationId,
      );
      conversations.push({
        // TikTok gives no customer id in these lists, so the conversation id is the key.
        externalId: conversationId,
        participantId: conversationId,
        participantName: null,
        participantUsername: customerUsername,
        messages,
      });
    }
  }
  return conversations;
}

/** Sends a text reply into a conversation; TikTok allows 10 within 48 hours of the customer's message. */
export async function sendTikTokMessage(
  account: AccountRef,
  token: string,
  conversationId: string,
  body: string,
): Promise<string> {
  const data = await tiktokCall('/business/message/send/', {
    method: 'POST',
    headers: { 'Access-Token': token, 'content-type': 'application/json' },
    body: JSON.stringify({
      business_id: account.externalId,
      recipient_type: 'CONVERSATION',
      recipient: { conversation_id: conversationId },
      message_type: 'TEXT',
      text: { body },
    }),
  });
  const id =
    text((data.message as { message_id?: unknown } | undefined)?.message_id) ??
    text(data.message_id);
  if (!id)
    throw new ProviderError('tiktok', 'TikTok accepted the reply but did not return its id.');
  return id;
}

/** What a TikTok webhook says, enough to know which account and conversation to read again. */
export type TikTokNotification = {
  appId: string;
  event: string;
  businessId: string;
  conversationId: string | null;
  /** im_mark_read_msg: the customer has read everything sent up to this time. */
  lastReadAt: Date | null;
};

/**
 * TikTok notifications are acted on through the API, never stored as they stand: they only say
 * which conversation to fetch again, with the account's own token. A forged one costs one read
 * and plants nothing. Only a read receipt, which the API cannot confirm, needs a signature.
 */
export function parseTikTokWebhook(body: unknown): TikTokNotification | null {
  const root = body as {
    client_key?: unknown;
    event?: unknown;
    user_openid?: unknown;
    content?: unknown;
  };
  const appId = text(root?.client_key);
  const event = text(root?.event);
  const businessId = text(root?.user_openid);
  if (!appId || !event || !businessId) return null;
  let conversationId: string | null = null;
  let lastReadAt: Date | null = null;
  if (typeof root.content === 'string' && root.content.length < 100_000) {
    try {
      const content = JSON.parse(root.content) as {
        conversation_id?: unknown;
        read?: { last_read_timestamp?: unknown };
      };
      conversationId = text(content.conversation_id);
      const last = content.read?.last_read_timestamp;
      lastReadAt = typeof last === 'number' && last > 0 ? new Date(last) : null;
    } catch {
      conversationId = null;
    }
  }
  return { appId, event, businessId, conversationId, lastReadAt };
}

/** Notifications older or newer than this are refused as replays. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Checks a `TikTok-Signature: t=<unix seconds>,s=<hex>` header: HMAC-SHA256 of
 * `<t>.<raw body>` keyed with the app secret, within five minutes. This is the scheme TikTok
 * documents for its webhooks; confirm it on the developer portal for Business Messaging, because
 * a notification that fails it is only ever treated as unverified, never trusted (ADR-065).
 */
export function verifyTikTokSignature(
  rawBody: Uint8Array,
  header: string | null,
  secret: string,
  now = Date.now(),
): boolean {
  if (!header || header.length > 512) return false;
  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const [key, ...rest] = part.trim().split('=');
      return [key, rest.join('=')];
    }),
  );
  const timestamp = Number(parts.t);
  const signature = parts.s;
  if (!Number.isInteger(timestamp) || !signature || !/^[0-9a-f]+$/i.test(signature)) return false;
  if (Math.abs(now / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Uploads a picture for a reply (ADR-067): TikTok sends JPG and PNG up to 3 MB, as a message of
 * its own (no words with it). The id lasts 30 days.
 */
export async function uploadTikTokImage(
  account: AccountRef,
  token: string,
  file: { bytes: Uint8Array; mimeType: string; fileName: string },
): Promise<string> {
  const form = new FormData();
  form.append('business_id', account.externalId);
  form.append('media_type', 'IMAGE');
  form.append(
    'file',
    new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }),
    file.fileName,
  );
  const data = await tiktokCall('/business/message/media/upload/', {
    method: 'POST',
    headers: { 'Access-Token': token },
    body: form,
    timeoutMs: 30_000,
  });
  const mediaId = text(data.media_id);
  if (!mediaId)
    throw new ProviderError('tiktok', 'TikTok accepted the picture but did not return its id.');
  return mediaId;
}

/** Sends an uploaded picture into a conversation; it counts towards TikTok's ten replies. */
export async function sendTikTokImage(
  account: AccountRef,
  token: string,
  conversationId: string,
  mediaId: string,
): Promise<string> {
  const data = await tiktokCall('/business/message/send/', {
    method: 'POST',
    headers: { 'Access-Token': token, 'content-type': 'application/json' },
    body: JSON.stringify({
      business_id: account.externalId,
      recipient_type: 'CONVERSATION',
      recipient: { conversation_id: conversationId },
      message_type: 'IMAGE',
      image: { media_id: mediaId },
    }),
  });
  const sent =
    text((data.message as { message_id?: unknown } | undefined)?.message_id) ??
    text(data.message_id);
  if (!sent)
    throw new ProviderError('tiktok', 'TikTok accepted the picture but did not return its id.');
  return sent;
}
