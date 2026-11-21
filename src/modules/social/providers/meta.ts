import 'server-only';

import { serverEnv } from '@/server/env';

import { providerFetch } from './http';
import {
  ProviderError,
  type AccountRef,
  type DiscoveredAccount,
  type ProviderConversation,
  type ProviderMessage,
} from './types';

/*
 * Meta: Facebook Pages (Messenger) and Instagram professional accounts, through one Meta app and
 * Facebook Login for Business (ADR-064). The business logs in with a configuration that asks for
 * the messaging permissions; the code is exchanged for a Business Integration System User token
 * that belongs to the business's portfolio, not to the person who clicked. Pages are reached
 * with their own Page tokens, Instagram accounts with that system user token, both on
 * graph.facebook.com.
 */

function graph(path: string): string {
  return `https://graph.facebook.com/${serverEnv().META_GRAPH_VERSION}${path}`;
}

export function metaConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.META_APP_ID && env.META_APP_SECRET && env.META_LOGIN_CONFIG_ID);
}

function requireMeta() {
  const env = serverEnv();
  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_LOGIN_CONFIG_ID) {
    throw new ProviderError('meta', 'Facebook and Instagram are not set up on this platform yet.');
  }
  return {
    appId: env.META_APP_ID,
    secret: env.META_APP_SECRET,
    configId: env.META_LOGIN_CONFIG_ID,
  };
}

/** Where the business logs in with Facebook or Instagram and chooses what to share. */
export function metaAuthorizeUrl(state: string, redirectUri: string): string {
  const { appId, configId } = requireMeta();
  const url = new URL(`https://www.facebook.com/${serverEnv().META_GRAPH_VERSION}/dialog/oauth`);
  url.search = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    config_id: configId,
    response_type: 'code',
    override_default_response_type: 'true',
  }).toString();
  return url.toString();
}

/** The authorisation code, exchanged on the server for the business's system user token. */
export async function exchangeMetaCode(code: string, redirectUri: string): Promise<string> {
  const { appId, secret } = requireMeta();
  const body = (await providerFetch('meta', graph('/oauth/access_token'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: appId,
      client_secret: secret,
      redirect_uri: redirectUri,
      code,
    }),
  })) as { access_token?: unknown };
  if (typeof body.access_token !== 'string') {
    throw new ProviderError('meta', 'Meta did not return an access token.');
  }
  return body.access_token;
}

function authorized(token: string): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

type Page = {
  id?: unknown;
  name?: unknown;
  access_token?: unknown;
  picture?: { data?: { url?: unknown } };
  instagram_business_account?: InstagramAccount;
};
type InstagramAccount = {
  id?: unknown;
  username?: unknown;
  name?: unknown;
  profile_picture_url?: unknown;
};

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : null;

/**
 * Every Page and Instagram account the business shared during login. Instagram accounts come
 * both from the system user's assigned accounts (no Page needed) and from Pages they are
 * linked to; each appears once.
 */
export async function discoverMetaAccounts(token: string): Promise<DiscoveredAccount[]> {
  const [me, pages, assigned] = await Promise.all([
    providerFetch('meta', graph('/me?fields=client_business_id'), { headers: authorized(token) }),
    providerFetch(
      'meta',
      graph(
        '/me/accounts?limit=100&fields=id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}',
      ),
      { headers: authorized(token) },
    ),
    providerFetch(
      'meta',
      graph(
        '/me/assigned_instagram_accounts?limit=100&fields=id,username,name,profile_picture_url',
      ),
      { headers: authorized(token) },
    ).catch(() => ({ data: [] })),
  ]);
  const businessId = text((me as { client_business_id?: unknown }).client_business_id);
  const found = new Map<string, DiscoveredAccount>();
  const addInstagram = (account: InstagramAccount | undefined) => {
    const id = text(account?.id);
    if (!account || !id || found.has(`instagram:${id}`)) return;
    found.set(`instagram:${id}`, {
      platform: 'instagram',
      externalId: id,
      name: text(account.name) ?? text(account.username) ?? 'Instagram account',
      username: text(account.username),
      avatarUrl: text(account.profile_picture_url),
      providerBusinessId: businessId,
      accessToken: token,
      accessExpiresAt: null,
      refreshToken: null,
      refreshExpiresAt: null,
    });
  };
  for (const page of ((pages as { data?: Page[] }).data ?? []).slice(0, 100)) {
    const id = text(page.id);
    const pageToken = text(page.access_token);
    if (id && pageToken) {
      found.set(`facebook:${id}`, {
        platform: 'facebook',
        externalId: id,
        name: text(page.name) ?? 'Facebook Page',
        username: null,
        avatarUrl: text(page.picture?.data?.url),
        providerBusinessId: businessId,
        accessToken: page.access_token as string,
        accessExpiresAt: null,
        refreshToken: null,
        refreshExpiresAt: null,
      });
    }
    addInstagram(page.instagram_business_account);
  }
  for (const account of ((assigned as { data?: InstagramAccount[] }).data ?? []).slice(0, 100)) {
    addInstagram(account);
  }
  return [...found.values()];
}

/** Ask Meta to send this account's messages to our webhook. */
export async function subscribeMetaAccount(account: AccountRef, token: string): Promise<void> {
  // Messages, our own echoes and the customer's delivery and read receipts.
  const fields =
    account.platform === 'facebook'
      ? 'messages,message_echoes,message_deliveries,message_reads'
      : 'messages,messaging_seen';
  await providerFetch('meta', graph(`/${encodeURIComponent(account.externalId)}/subscribed_apps`), {
    method: 'POST',
    headers: { ...authorized(token), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ subscribed_fields: fields }),
  });
}

/** Stop the webhook for this account; called when the business disconnects it. */
export async function unsubscribeMetaAccount(account: AccountRef, token: string): Promise<void> {
  await providerFetch('meta', graph(`/${encodeURIComponent(account.externalId)}/subscribed_apps`), {
    method: 'DELETE',
    headers: authorized(token),
  });
}

type GraphMessage = {
  id?: unknown;
  created_time?: unknown;
  message?: unknown;
  from?: { id?: unknown; name?: unknown; username?: unknown };
  attachments?: {
    data?: {
      mime_type?: unknown;
      file_url?: unknown;
      image_data?: { url?: unknown };
      video_data?: { url?: unknown };
    }[];
  };
};

/** A message's attachments from the Conversations API, as links to fetch and save. */
function graphAttachments(message: GraphMessage) {
  return (message.attachments?.data ?? []).slice(0, 10).map((item) => {
    const mime = typeof item.mime_type === 'string' ? item.mime_type : '';
    const url = [item.image_data?.url, item.video_data?.url, item.file_url].find(
      (value): value is string => typeof value === 'string' && value.startsWith('https://'),
    );
    const type = mime.startsWith('image/')
      ? 'image'
      : mime.startsWith('video/')
        ? 'video'
        : mime.startsWith('audio/')
          ? 'audio'
          : 'file';
    return url ? { type, url } : { type };
  });
}

type GraphConversation = {
  id?: unknown;
  participants?: { data?: { id?: unknown; name?: unknown; username?: unknown }[] };
  messages?: { data?: GraphMessage[] };
};

/**
 * Recent conversations with their latest messages, for a newly connected account. Meta returns
 * the content of only the 20 most recent messages in each conversation.
 */
export async function fetchMetaConversations(
  account: AccountRef,
  token: string,
  limit = 25,
): Promise<ProviderConversation[]> {
  const platform = account.platform === 'facebook' ? 'messenger' : 'instagram';
  const fields =
    'id,participants,messages.limit(20){id,created_time,message,from,attachments{mime_type,file_url,image_data,video_data}}';
  const body = (await providerFetch(
    'meta',
    graph(
      `/${encodeURIComponent(account.externalId)}/conversations?platform=${platform}&limit=${limit}&fields=${encodeURIComponent(fields)}`,
    ),
    { headers: authorized(token), timeoutMs: 20_000 },
  )) as { data?: GraphConversation[] };
  const conversations: ProviderConversation[] = [];
  for (const conversation of (body.data ?? []).slice(0, limit)) {
    const customer = (conversation.participants?.data ?? []).find(
      (person) => text(person.id) && person.id !== account.externalId,
    );
    const participantId = text(customer?.id);
    if (!participantId) continue;
    const messages: ProviderMessage[] = [];
    for (const message of conversation.messages?.data ?? []) {
      const id = text(message.id);
      const sentAt =
        typeof message.created_time === 'string' ? new Date(message.created_time) : null;
      if (!id || !sentAt || Number.isNaN(sentAt.getTime())) continue;
      messages.push({
        externalId: id,
        direction: message.from?.id === account.externalId ? 'outbound' : 'inbound',
        body: typeof message.message === 'string' && message.message ? message.message : null,
        attachments: graphAttachments(message),
        sentAt,
      });
    }
    conversations.push({
      externalId: text(conversation.id),
      participantId,
      participantName: text(customer?.name),
      participantUsername: text(customer?.username),
      messages,
    });
  }
  return conversations;
}

/** The customer's name, handle and picture, for a conversation that started with a webhook. */
export async function fetchMetaProfile(
  account: AccountRef,
  token: string,
  participantId: string,
): Promise<{ name: string | null; username: string | null; pictureUrl: string | null }> {
  const fields =
    account.platform === 'facebook'
      ? 'first_name,last_name,profile_pic'
      : 'name,username,profile_pic';
  const body = (await providerFetch(
    'meta',
    graph(`/${encodeURIComponent(participantId)}?fields=${fields}`),
    { headers: authorized(token), timeoutMs: 3_000 },
  )) as {
    first_name?: unknown;
    last_name?: unknown;
    name?: unknown;
    username?: unknown;
    profile_pic?: unknown;
  };
  const full = [text(body.first_name), text(body.last_name)].filter(Boolean).join(' ');
  const picture = typeof body.profile_pic === 'string' ? body.profile_pic : null;
  return {
    name: text(body.name) ?? (full || null),
    username: text(body.username),
    pictureUrl: picture && picture.startsWith('https://') ? picture : null,
  };
}

/**
 * Sends a text reply. Inside 24 hours of the customer's last message it is a normal response;
 * up to 7 days it goes with the HUMAN_AGENT tag, which Meta allows for a person answering (and
 * which needs Meta's approval of the Human Agent permission).
 */
export async function sendMetaMessage(
  account: AccountRef,
  token: string,
  participantId: string,
  body: string,
  humanAgent: boolean,
): Promise<string> {
  const payload: Record<string, unknown> = {
    recipient: { id: participantId },
    message: { text: body },
    messaging_type: humanAgent ? 'MESSAGE_TAG' : 'RESPONSE',
  };
  if (humanAgent) payload.tag = 'HUMAN_AGENT';
  const result = (await providerFetch(
    'meta',
    graph(`/${encodeURIComponent(account.externalId)}/messages`),
    {
      method: 'POST',
      headers: { ...authorized(token), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )) as { message_id?: unknown };
  if (typeof result.message_id !== 'string') {
    throw new ProviderError('meta', 'Meta accepted the reply but did not return its id.');
  }
  return result.message_id;
}
