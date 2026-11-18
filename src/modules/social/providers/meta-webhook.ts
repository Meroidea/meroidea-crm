import { createHmac, timingSafeEqual } from 'node:crypto';

import type { ProviderAttachment, ProviderMessage, SocialPlatform } from './types';

/**
 * Meta signs every webhook with `X-Hub-Signature-256: sha256=<hex>`, an HMAC-SHA256 of the raw
 * request body keyed with the app secret. The raw bytes must be hashed as received: Meta signs
 * its escaped-unicode JSON, so re-serialising the parsed body gives a different hash.
 */
export function verifyMetaSignature(
  rawBody: Uint8Array,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** One message event from a Meta webhook, normalised. */
export type MetaMessageEvent = {
  platform: Extract<SocialPlatform, 'facebook' | 'instagram'>;
  /** The business's Page or Instagram account the event belongs to. */
  accountExternalId: string;
  /** The customer's page- or account-scoped id. */
  participantId: string;
  message: ProviderMessage;
};

type Messaging = {
  sender?: { id?: unknown };
  recipient?: { id?: unknown };
  timestamp?: unknown;
  message?: {
    mid?: unknown;
    text?: unknown;
    is_echo?: unknown;
    is_deleted?: unknown;
    attachments?: unknown;
  };
};

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : null;

function attachmentsOf(value: unknown): ProviderAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).map((item) => {
    const raw = item as { type?: unknown; payload?: { url?: unknown } };
    const type = typeof raw.type === 'string' ? raw.type.slice(0, 20) : 'other';
    const url = raw.payload?.url;
    return typeof url === 'string' && /^https:\/\//.test(url) && url.length < 2048
      ? { type, url }
      : { type };
  });
}

/**
 * The message events in a verified Meta webhook body, for Pages (`object: page`) and Instagram
 * accounts (`object: instagram`). Reads, deliveries, reactions and deleted messages are skipped:
 * the inbox shows what was said. An echo is the business's own message, sent from Meroidea or
 * from the Facebook or Instagram app.
 */
export function parseMetaWebhook(body: unknown): MetaMessageEvent[] {
  const root = body as { object?: unknown; entry?: unknown };
  const platform =
    root?.object === 'page' ? 'facebook' : root?.object === 'instagram' ? 'instagram' : null;
  if (!platform || !Array.isArray(root.entry)) return [];
  const events: MetaMessageEvent[] = [];
  for (const entry of root.entry.slice(0, 100)) {
    const accountExternalId = str((entry as { id?: unknown }).id);
    const messaging = (entry as { messaging?: unknown }).messaging;
    if (!accountExternalId || !Array.isArray(messaging)) continue;
    for (const item of messaging.slice(0, 100) as Messaging[]) {
      const message = item.message;
      const mid = str(message?.mid);
      if (!message || !mid || message.is_deleted === true) continue;
      const echo = message.is_echo === true;
      const senderId = str(item.sender?.id);
      const recipientId = str(item.recipient?.id);
      const participantId = echo ? recipientId : senderId;
      if (!participantId) continue;
      const timestamp = typeof item.timestamp === 'number' ? item.timestamp : Date.now();
      events.push({
        platform,
        accountExternalId,
        participantId,
        message: {
          externalId: mid,
          direction: echo ? 'outbound' : 'inbound',
          body: typeof message.text === 'string' ? message.text.slice(0, 20_000) : null,
          attachments: attachmentsOf(message.attachments),
          sentAt: new Date(timestamp),
        },
      });
    }
  }
  return events;
}
