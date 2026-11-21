import 'server-only';

import { serverEnv } from '@/server/env';

import { providerFetch } from './http';
import { ProviderError } from './types';

/*
 * WhatsApp Business Platform (Cloud API), through the same Meta app as Facebook and Instagram
 * (ADR-066). A business connects a number with Meta's Embedded Signup, which hands the page a
 * one-time code; the server exchanges it for a Business Integration System User token that
 * belongs to the business's portfolio and does not expire. Every call goes to graph.facebook.com
 * with that token in a header.
 */

function graph(path: string): string {
  return `https://graph.facebook.com/${serverEnv().META_GRAPH_VERSION}${path}`;
}

const id = (value: string) => encodeURIComponent(value);

function authorized(token: string, json = false): HeadersInit {
  return json
    ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    : { authorization: `Bearer ${token}` };
}

export function whatsappConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.META_APP_ID && env.META_APP_SECRET && env.META_WHATSAPP_CONFIG_ID);
}

/**
 * What the browser needs to open Embedded Signup. The app id and configuration id are public
 * identifiers by Meta's design (they are in every Facebook Login page); the secret never leaves
 * the server.
 */
export function whatsappSignupSettings(): {
  appId: string;
  configId: string;
  graphVersion: string;
} | null {
  const env = serverEnv();
  if (!whatsappConfigured()) return null;
  return {
    appId: env.META_APP_ID!,
    configId: env.META_WHATSAPP_CONFIG_ID!,
    graphVersion: env.META_GRAPH_VERSION,
  };
}

/** Meta's error codes for WhatsApp, in words a business can act on. */
const WHATSAPP_REASONS: Record<number, string> = {
  131047:
    'More than 24 hours have passed since the customer last wrote. Send an approved template instead.',
  131042:
    'WhatsApp did not send it because of a billing problem. Add or fix the payment method in Meta Business Suite (Billing & payments).',
  131026:
    'WhatsApp could not deliver it: the number may not use WhatsApp, or the customer’s app is out of date.',
  131049: 'WhatsApp held it back to protect the customer from too many business messages.',
  131048: 'WhatsApp is limiting this number for spam. Check its quality in WhatsApp Manager.',
  131050: 'The customer has stopped marketing messages from your business.',
  131051: 'WhatsApp does not support that kind of message.',
  130403: 'The customer has blocked your business on WhatsApp.',
  132000: 'The template’s values do not match its placeholders.',
  132001: 'That template does not exist in this language or is not approved yet.',
  132015: 'That template is paused because of low quality. Choose another.',
  132016: 'That template is disabled. Choose another.',
  132018: 'One of the template’s values is not allowed (no line breaks or tabs).',
  133010: 'The number is not registered with WhatsApp yet. Connect it again.',
  133005: 'The number’s two-step verification PIN does not match.',
};

/** A WhatsApp failure code as words for the business, or null when unknown. */
export function whatsappReason(code: unknown): string | null {
  const value = typeof code === 'string' ? Number(code) : code;
  return typeof value === 'number' ? (WHATSAPP_REASONS[value] ?? null) : null;
}

async function call(url: string, init: RequestInit & { timeoutMs?: number }): Promise<unknown> {
  try {
    return await providerFetch('whatsapp', url, init);
  } catch (error) {
    if (error instanceof ProviderError) {
      const reason = whatsappReason(error.code);
      if (reason) {
        throw new ProviderError('whatsapp', reason, {
          reconnect: error.reconnect,
          rateLimited: error.rateLimited,
          retryAfterMinutes: error.retryAfterMinutes,
          code: error.code,
        });
      }
    }
    throw error;
  }
}

/**
 * The code from Embedded Signup, exchanged on the server for the business's token. The flow
 * runs in Meta's popup, so no redirect address is part of the exchange.
 */
export async function exchangeWhatsAppCode(code: string): Promise<string> {
  const env = serverEnv();
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    throw new ProviderError('whatsapp', 'WhatsApp is not set up on this platform yet.');
  }
  const body = (await call(graph('/oauth/access_token'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      code,
    }),
  })) as { access_token?: unknown };
  if (typeof body.access_token !== 'string') {
    throw new ProviderError('whatsapp', 'Meta did not return an access token.');
  }
  return body.access_token;
}

const text = (value: unknown, max = 300): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

export type WhatsAppNumber = {
  phoneNumberId: string;
  wabaId: string;
  verifiedName: string | null;
  displayPhone: string | null;
};

/**
 * The number the business chose in Embedded Signup. The page reports the account and number
 * ids, but the page is the browser's: they are trusted only once the business's own new token
 * finds that number in that account.
 */
export async function findWhatsAppNumber(
  token: string,
  wabaId: string,
  phoneNumberId: string,
): Promise<WhatsAppNumber> {
  const body = (await call(
    graph(`/${id(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100`),
    { headers: authorized(token) },
  )) as { data?: { id?: unknown; display_phone_number?: unknown; verified_name?: unknown }[] };
  const found = (body.data ?? []).find((number) => number.id === phoneNumberId);
  if (!found) {
    throw new ProviderError(
      'whatsapp',
      'That WhatsApp number was not shared with Meroidea. Please try connecting again.',
    );
  }
  return {
    phoneNumberId,
    wabaId,
    verifiedName: text(found.verified_name),
    displayPhone: text(found.display_phone_number, 40),
  };
}

/** Ask Meta to send the WhatsApp Business Account's messages and changes to our webhook. */
export async function subscribeWhatsAppAccount(token: string, wabaId: string): Promise<void> {
  await call(graph(`/${id(wabaId)}/subscribed_apps`), {
    method: 'POST',
    headers: authorized(token),
  });
}

/** Stop the webhook for the WhatsApp Business Account. */
export async function unsubscribeWhatsAppAccount(token: string, wabaId: string): Promise<void> {
  await call(graph(`/${id(wabaId)}/subscribed_apps`), {
    method: 'DELETE',
    headers: authorized(token),
  });
}

/**
 * Registers a new number for the Cloud API, setting its two-step verification PIN. Not used for
 * a WhatsApp Business app number, which is registered already.
 */
export async function registerWhatsAppNumber(
  token: string,
  phoneNumberId: string,
  pin: string,
): Promise<void> {
  await call(graph(`/${id(phoneNumberId)}/register`), {
    method: 'POST',
    headers: authorized(token, true),
    body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
  });
}

/**
 * For a WhatsApp Business app number: asks WhatsApp to send the app's contacts or its chat
 * history (180 days) by webhook. Each may be asked once, the history within 24 hours of
 * connecting.
 */
export async function requestWhatsAppSync(
  token: string,
  phoneNumberId: string,
  kind: 'smb_app_state_sync' | 'history',
): Promise<void> {
  await call(graph(`/${id(phoneNumberId)}/smb_app_data`), {
    method: 'POST',
    headers: authorized(token, true),
    body: JSON.stringify({ messaging_product: 'whatsapp', sync_type: kind }),
  });
}

/**
 * Who a message goes to: the customer's number, or their business-scoped user id when they
 * have a username and keep their number to themselves.
 */
export function whatsappRecipient(participantId: string): Record<string, string> {
  return /^\d{6,20}$/.test(participantId)
    ? { to: `+${participantId}` }
    : { recipient: participantId };
}

async function sendMessage(
  token: string,
  phoneNumberId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const result = (await call(graph(`/${id(phoneNumberId)}/messages`), {
    method: 'POST',
    headers: authorized(token, true),
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      ...payload,
    }),
  })) as { messages?: { id?: unknown }[] };
  const wamid = result.messages?.[0]?.id;
  if (typeof wamid !== 'string') {
    throw new ProviderError('whatsapp', 'WhatsApp accepted the message but did not return its id.');
  }
  return wamid;
}

/** A free-form text reply, allowed within 24 hours of the customer's last message. */
export function sendWhatsAppText(
  token: string,
  phoneNumberId: string,
  participantId: string,
  body: string,
): Promise<string> {
  return sendMessage(token, phoneNumberId, {
    ...whatsappRecipient(participantId),
    type: 'text',
    text: { body, preview_url: false },
  });
}

export type TemplateSend = {
  name: string;
  language: string;
  parameterFormat: 'positional' | 'named';
  /** The body's placeholders in order ("1", "2" or names) and the value for each. */
  parameters: string[];
  values: string[];
};

/** An approved template, which may be sent at any time. */
export function sendWhatsAppTemplate(
  token: string,
  phoneNumberId: string,
  participantId: string,
  template: TemplateSend,
): Promise<string> {
  const parameters = template.values.map((value, index) =>
    template.parameterFormat === 'named'
      ? { type: 'text', parameter_name: template.parameters[index], text: value }
      : { type: 'text', text: value },
  );
  return sendMessage(token, phoneNumberId, {
    ...whatsappRecipient(participantId),
    type: 'template',
    template: {
      name: template.name,
      language: { code: template.language },
      ...(parameters.length > 0 ? { components: [{ type: 'body', parameters }] } : {}),
    },
  });
}

/**
 * Where a customer's media file can be downloaded from, for the next five minutes. The address
 * needs the token too, which media.ts sends only to Meta's own hosts.
 */
export async function whatsappMediaUrl(
  token: string,
  mediaId: string,
  phoneNumberId: string,
): Promise<string> {
  const body = (await call(graph(`/${id(mediaId)}?phone_number_id=${id(phoneNumberId)}`), {
    headers: authorized(token),
  })) as { url?: unknown };
  if (typeof body.url !== 'string' || !body.url.startsWith('https://')) {
    throw new ProviderError('whatsapp', 'WhatsApp did not say where the file is.');
  }
  return body.url;
}

export type ParsedTemplate = {
  externalId: string;
  name: string;
  language: string;
  category: string;
  status: string;
  parameterFormat: 'positional' | 'named';
  body: string;
  headerText: string | null;
  footerText: string | null;
  parameters: string[];
  sendable: boolean;
  reason: string | null;
};

type RawComponent = {
  type?: unknown;
  format?: unknown;
  text?: unknown;
  buttons?: { type?: unknown; url?: unknown; example?: unknown }[];
};

type RawTemplate = {
  id?: unknown;
  name?: unknown;
  language?: unknown;
  category?: unknown;
  status?: unknown;
  parameter_format?: unknown;
  components?: RawComponent[];
  rejected_reason?: unknown;
};

/** The placeholders in a template body, in order of first appearance: "1", "2" or names. */
export function templatePlaceholders(body: string): string[] {
  const seen: string[] = [];
  for (const match of body.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
    const name = match[1]!;
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

/**
 * A template as Meta lists it, reduced to what the inbox shows and sends. Meroidea sends the
 * body's values only, so a template with a media header, a header placeholder or a button that
 * needs a value is kept but marked as not sendable from here.
 */
export function parseTemplate(raw: RawTemplate): ParsedTemplate | null {
  const externalId = text(raw.id, 64);
  const name = text(raw.name, 512);
  const language = text(raw.language, 20);
  if (!externalId || !name || !language) return null;
  const components = Array.isArray(raw.components) ? raw.components : [];
  const find = (type: string) =>
    components.find((component) => String(component.type).toUpperCase() === type);
  const bodyText = text(find('BODY')?.text, 1100) ?? '';
  const header = find('HEADER');
  const headerText =
    header && String(header.format ?? 'TEXT').toUpperCase() === 'TEXT'
      ? text(header.text, 100)
      : null;
  const buttonNeedsValue = (find('BUTTONS')?.buttons ?? []).some((button) => {
    const type = String(button.type).toUpperCase();
    return (
      (type === 'URL' && typeof button.url === 'string' && button.url.includes('{{')) ||
      ['COPY_CODE', 'OTP', 'FLOW', 'CATALOG', 'MPM'].includes(type)
    );
  });
  const sendable =
    Boolean(bodyText) &&
    (!header || (headerText !== null && !headerText.includes('{{'))) &&
    !buttonNeedsValue &&
    String(raw.category).toUpperCase() !== 'AUTHENTICATION';
  return {
    externalId,
    name,
    language,
    category: String(raw.category ?? 'utility')
      .toLowerCase()
      .slice(0, 40),
    status: String(raw.status ?? 'pending')
      .toLowerCase()
      .slice(0, 40),
    parameterFormat:
      String(raw.parameter_format).toLowerCase() === 'named' ? 'named' : 'positional',
    body: bodyText,
    headerText,
    footerText: text(find('FOOTER')?.text, 100),
    parameters: templatePlaceholders(bodyText),
    sendable,
    reason: text(raw.rejected_reason, 200) === 'NONE' ? null : text(raw.rejected_reason, 200),
  };
}

/** The account's templates (up to 500), newest first as Meta returns them. */
export async function listWhatsAppTemplates(
  token: string,
  wabaId: string,
): Promise<ParsedTemplate[]> {
  const fields = 'id,name,language,status,category,parameter_format,components,rejected_reason';
  let url: string | null = graph(
    `/${id(wabaId)}/message_templates?limit=100&fields=${encodeURIComponent(fields)}`,
  );
  const found: ParsedTemplate[] = [];
  for (let page = 0; url && page < 5; page += 1) {
    const body = (await call(url, { headers: authorized(token), timeoutMs: 15_000 })) as {
      data?: RawTemplate[];
      paging?: { next?: unknown };
    };
    for (const raw of body.data ?? []) {
      const parsed = parseTemplate(raw);
      if (parsed) found.push(parsed);
    }
    const next = body.paging?.next;
    // Follow Meta's own next page only; never an address that leaves the Graph API.
    url = typeof next === 'string' && next.startsWith('https://graph.facebook.com/') ? next : null;
  }
  return found;
}

export type NewTemplate = {
  name: string;
  category: 'utility' | 'marketing';
  language: string;
  body: string;
  examples: string[];
  headerText: string | null;
  footerText: string | null;
};

/** Submits a template for Meta's review; it can be sent once approved. */
export async function createWhatsAppTemplate(
  token: string,
  wabaId: string,
  template: NewTemplate,
): Promise<{ externalId: string; status: string; category: string }> {
  const components: Record<string, unknown>[] = [];
  if (template.headerText) {
    components.push({ type: 'HEADER', format: 'TEXT', text: template.headerText });
  }
  components.push({
    type: 'BODY',
    text: template.body,
    ...(template.examples.length > 0 ? { example: { body_text: [template.examples] } } : {}),
  });
  if (template.footerText) components.push({ type: 'FOOTER', text: template.footerText });
  const result = (await call(graph(`/${id(wabaId)}/message_templates`), {
    method: 'POST',
    headers: authorized(token, true),
    body: JSON.stringify({
      name: template.name,
      category: template.category.toUpperCase(),
      language: template.language,
      parameter_format: 'positional',
      components,
    }),
  })) as { id?: unknown; status?: unknown; category?: unknown };
  const externalId = text(result.id, 64);
  if (!externalId) {
    throw new ProviderError('whatsapp', 'Meta accepted the template but did not return its id.');
  }
  return {
    externalId,
    status: String(result.status ?? 'pending').toLowerCase(),
    category: String(result.category ?? template.category).toLowerCase(),
  };
}

/** Deletes one template (one language of it) from the WhatsApp Business Account. */
export async function deleteWhatsAppTemplate(
  token: string,
  wabaId: string,
  template: { name: string; externalId: string },
): Promise<void> {
  const query = new URLSearchParams({ name: template.name, hsm_id: template.externalId });
  await call(graph(`/${id(wabaId)}/message_templates?${query.toString()}`), {
    method: 'DELETE',
    headers: authorized(token),
  });
}
