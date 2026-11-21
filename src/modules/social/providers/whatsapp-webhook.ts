import type { ProviderAttachment, ProviderMessage } from './types';

/*
 * WhatsApp webhooks (object `whatsapp_business_account`), signed like every Meta webhook and
 * checked by verifyMetaSignature before anything here runs (ADR-066). Each change names the
 * business's phone number by id, which decides the one business it belongs to.
 */

/** A customer's message, or the business's own sent from the WhatsApp Business app. */
export type WhatsAppMessageEvent = {
  phoneNumberId: string;
  participantId: string;
  participantPhone: string | null;
  participantName: string | null;
  message: ProviderMessage;
};

/** The business edited or deleted a message in the WhatsApp Business app. */
export type WhatsAppChangeEvent = {
  phoneNumberId: string;
  originalId: string;
  kind: 'edit' | 'revoke';
  body: string | null;
};

export type WhatsAppStatusEvent = {
  phoneNumberId: string;
  messageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  at: Date;
  errorCode: number | null;
  errorTitle: string | null;
};

export type WhatsAppHistoryEvent = {
  phoneNumberId: string;
  progress: number | null;
  /** The business turned history sharing off in the WhatsApp Business app. */
  declined: boolean;
  threads: {
    participantId: string;
    participantPhone: string | null;
    messages: ProviderMessage[];
  }[];
};

export type WhatsAppContactsEvent = {
  phoneNumberId: string;
  contacts: { phone: string; name: string }[];
};

export type WhatsAppTemplateEvent = {
  wabaId: string;
  templateId: string;
  status: string;
  reason: string | null;
};

export type WhatsAppWebhook = {
  messages: WhatsAppMessageEvent[];
  changes: WhatsAppChangeEvent[];
  statuses: WhatsAppStatusEvent[];
  history: WhatsAppHistoryEvent[];
  contacts: WhatsAppContactsEvent[];
  templates: WhatsAppTemplateEvent[];
};

type Raw = Record<string, unknown>;

const str = (value: unknown, max = 512): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;

const obj = (value: unknown): Raw | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : null;

const list = (value: unknown, max: number): unknown[] =>
  Array.isArray(value) ? value.slice(0, max) : [];

/** A phone number as digits only, or null. */
export function phoneDigits(value: unknown): string | null {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  return digits.length >= 6 && digits.length <= 20 ? digits : null;
}

function timestampOf(value: unknown): Date | null {
  const seconds = typeof value === 'string' ? Number(value) : value;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);

/**
 * A message's words and files. Media come as ids, fetched later with the account's token; the
 * `url` WhatsApp sometimes includes needs the token too, so it is not kept. Null for what the
 * inbox does not show: reactions, edits arriving as unsupported, system notices.
 */
export function contentOf(
  raw: Raw,
): { body: string | null; attachments: ProviderAttachment[] } | null {
  const type = str(raw.type, 40);
  if (!type) return null;
  if (type === 'text') {
    const body = str(obj(raw.text)?.body, 8000);
    return body ? { body, attachments: [] } : null;
  }
  if (MEDIA_TYPES.has(type)) {
    const media = obj(raw[type]);
    const mediaId = str(media?.id, 128);
    const caption = str(media?.caption, 3000);
    const filename = type === 'document' ? str(media?.filename, 240) : null;
    return {
      body: caption ?? filename,
      attachments: [mediaId ? { type, mediaId } : { type }],
    };
  }
  if (type === 'media_placeholder') {
    // A history message whose file follows in a later webhook, if it is recent enough.
    return { body: null, attachments: [{ type: 'file', placeholder: true }] };
  }
  if (type === 'location') {
    const place = obj(raw.location);
    const lat = Number(place?.latitude);
    const lng = Number(place?.longitude);
    const label = [str(place?.name, 200), str(place?.address, 300)].filter(Boolean).join(', ');
    const where =
      Number.isFinite(lat) && Number.isFinite(lng)
        ? `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`
        : null;
    return {
      body: ['Shared a location', label || null, where].filter(Boolean).join('\n'),
      attachments: [],
    };
  }
  if (type === 'contacts') {
    const shared = list(raw.contacts, 5).map((item) => {
      const card = obj(item);
      const name = str(obj(card?.name)?.formatted_name, 200);
      const phone = str(obj(list(card?.phones, 1)[0])?.phone, 40);
      return [name, phone].filter(Boolean).join(' ');
    });
    return {
      body: `Shared a contact: ${shared.filter(Boolean).join('; ') || 'contact card'}`,
      attachments: [],
    };
  }
  if (type === 'interactive') {
    const interactive = obj(raw.interactive);
    const reply = obj(interactive?.button_reply) ?? obj(interactive?.list_reply);
    const title = str(reply?.title, 200);
    return title ? { body: title, attachments: [] } : null;
  }
  if (type === 'button') {
    const title = str(obj(raw.button)?.text, 200);
    return title ? { body: title, attachments: [] } : null;
  }
  if (type === 'unsupported') {
    const kind = str(obj(raw.unsupported)?.type, 40);
    // A customer's edit arrives as an unsupported message with nothing to show.
    if (kind === 'edit') return null;
    return {
      body: 'Sent a kind of message Meroidea cannot show yet. Open WhatsApp to see it.',
      attachments: [],
    };
  }
  return null;
}

const OUTBOUND_STATES: Record<string, ProviderMessage['status']> = {
  SENT: 'sent',
  PENDING: 'sent',
  DELIVERED: 'delivered',
  READ: 'read',
  PLAYED: 'read',
  ERROR: 'failed',
};

/** The WhatsApp changes in a verified webhook body; anything else is ignored. */
export function parseWhatsAppWebhook(body: unknown): WhatsAppWebhook {
  const parsed: WhatsAppWebhook = {
    messages: [],
    changes: [],
    statuses: [],
    history: [],
    contacts: [],
    templates: [],
  };
  const root = obj(body);
  if (root?.object !== 'whatsapp_business_account') return parsed;
  for (const entryRaw of list(root.entry, 100)) {
    const entry = obj(entryRaw);
    const wabaId = str(entry?.id, 64);
    for (const changeRaw of list(entry?.changes, 100)) {
      const change = obj(changeRaw);
      const field = str(change?.field, 64);
      const value = obj(change?.value);
      if (!field || !value) continue;
      if (field === 'message_template_status_update') {
        const templateId = value.message_template_id;
        const event = str(value.event, 40);
        if (wabaId && event && (typeof templateId === 'number' || typeof templateId === 'string')) {
          const reason = str(value.reason, 200);
          parsed.templates.push({
            wabaId,
            templateId: String(templateId),
            status: event.toLowerCase(),
            reason: reason && reason !== 'NONE' ? reason : null,
          });
        }
        continue;
      }
      const phoneNumberId = str(obj(value.metadata)?.phone_number_id, 64);
      if (!phoneNumberId) continue;
      if (field === 'messages') readMessages(value, phoneNumberId, parsed);
      else if (field === 'smb_message_echoes') readEchoes(value, phoneNumberId, parsed);
      else if (field === 'history') readHistory(value, phoneNumberId, parsed);
      else if (field === 'smb_app_state_sync') readContacts(value, phoneNumberId, parsed);
    }
  }
  return parsed;
}

function readMessages(value: Raw, phoneNumberId: string, parsed: WhatsAppWebhook) {
  const names = new Map<string, string>();
  for (const contactRaw of list(value.contacts, 100)) {
    const contact = obj(contactRaw);
    const name = str(obj(contact?.profile)?.name, 200);
    for (const key of [str(contact?.wa_id, 64), str(contact?.user_id, 128)]) {
      if (key && name) names.set(key, name);
    }
  }
  for (const raw of list(value.messages, 100)) {
    const message = obj(raw);
    if (!message) continue;
    const externalId = str(message.id, 256);
    const sentAt = timestampOf(message.timestamp);
    const phone = phoneDigits(message.from);
    const participantId = phone ?? str(message.from_user_id, 128);
    const content = contentOf(message);
    if (!externalId || !sentAt || !participantId || !content) continue;
    parsed.messages.push({
      phoneNumberId,
      participantId,
      participantPhone: phone,
      participantName:
        names.get(str(message.from, 64) ?? '') ??
        names.get(str(message.from_user_id, 128) ?? '') ??
        null,
      message: { externalId, direction: 'inbound', sentAt, ...content },
    });
  }
  for (const raw of list(value.statuses, 200)) {
    const status = obj(raw);
    const messageId = str(status?.id, 256);
    const state = str(status?.status, 20);
    const at = timestampOf(status?.timestamp);
    if (!messageId || !at || !state || !['sent', 'delivered', 'read', 'failed'].includes(state)) {
      continue;
    }
    const error = obj(list(status?.errors, 1)[0]);
    const code = typeof error?.code === 'number' ? error.code : null;
    parsed.statuses.push({
      phoneNumberId,
      messageId,
      status: state as WhatsAppStatusEvent['status'],
      at,
      errorCode: code,
      errorTitle: str(error?.title, 200),
    });
  }
}

/** Messages the business sent from the WhatsApp Business app on its phone (coexistence). */
function readEchoes(value: Raw, phoneNumberId: string, parsed: WhatsAppWebhook) {
  for (const raw of list(value.message_echoes, 100)) {
    const echo = obj(raw);
    if (!echo) continue;
    const type = str(echo.type, 40);
    if (type === 'revoke' || type === 'edit') {
      const detail = obj(echo[type]);
      const originalId = str(detail?.original_message_id, 256);
      if (!originalId) continue;
      const edited = type === 'edit' ? contentOf(obj(detail?.message) ?? {}) : null;
      parsed.changes.push({
        phoneNumberId,
        originalId,
        kind: type,
        body: edited?.body ?? null,
      });
      continue;
    }
    const externalId = str(echo.id, 256);
    const sentAt = timestampOf(echo.timestamp);
    const phone = phoneDigits(echo.to);
    const participantId = phone ?? str(echo.to_user_id, 128);
    const content = contentOf(echo);
    if (!externalId || !sentAt || !participantId || !content) continue;
    parsed.messages.push({
      phoneNumberId,
      participantId,
      participantPhone: phone,
      participantName: null,
      message: { externalId, direction: 'outbound', sentAt, ...content },
    });
  }
}

/** The WhatsApp Business app's chat history, sent in chunks after a number is connected. */
function readHistory(value: Raw, phoneNumberId: string, parsed: WhatsAppWebhook) {
  for (const raw of list(value.history, 50)) {
    const chunk = obj(raw);
    if (!chunk) continue;
    const declined = list(chunk.errors, 5).some((error) => obj(error)?.code === 2593109);
    const progress = Number(obj(chunk.metadata)?.progress);
    const event: WhatsAppHistoryEvent = {
      phoneNumberId,
      progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : null,
      declined,
      threads: [],
    };
    for (const threadRaw of list(chunk.threads, 1000)) {
      const thread = obj(threadRaw);
      const context = obj(thread?.context);
      const phone = phoneDigits(context?.wa_id) ?? phoneDigits(thread?.id);
      const userId = str(context?.user_id, 128);
      const participantId = phone ?? userId;
      if (!participantId) continue;
      const messages: ProviderMessage[] = [];
      for (const messageRaw of list(thread?.messages, 5000)) {
        const message = obj(messageRaw);
        if (!message) continue;
        const externalId = str(message.id, 256);
        const sentAt = timestampOf(message.timestamp);
        const content = contentOf(message);
        if (!externalId || !sentAt || !content) continue;
        const from = phoneDigits(message.from);
        const inbound =
          (phone !== null && from === phone) ||
          (userId !== null && str(message.from_user_id, 128) === userId);
        const state = str(obj(message.history_context)?.status, 20);
        messages.push({
          externalId,
          direction: inbound ? 'inbound' : 'outbound',
          sentAt,
          ...content,
          ...(inbound ? {} : { status: OUTBOUND_STATES[state ?? ''] ?? 'sent' }),
        });
      }
      event.threads.push({ participantId, participantPhone: phone, messages });
    }
    parsed.history.push(event);
  }
}

/** The WhatsApp Business app's contacts, so known customers show by the business's own name. */
function readContacts(value: Raw, phoneNumberId: string, parsed: WhatsAppWebhook) {
  const contacts: { phone: string; name: string }[] = [];
  for (const raw of list(value.state_sync, 5000)) {
    const item = obj(raw);
    if (item?.type !== 'contact' || item.action === 'remove') continue;
    const contact = obj(item.contact);
    const phone = phoneDigits(contact?.phone_number);
    const name = str(contact?.full_name, 200) ?? str(contact?.first_name, 200);
    if (phone && name) contacts.push({ phone, name });
  }
  if (contacts.length > 0) parsed.contacts.push({ phoneNumberId, contacts });
}
