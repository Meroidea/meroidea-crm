import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { after } from 'next/server';

import { socialConversations, socialMessages } from '@/db/schema';
import type { Tx } from '@/server/db/with-rls';
import { writeSocialMedia } from '@/server/storage';

import { tiktokMediaUrl } from './providers/tiktok';
import { ProviderError, type AccountRef } from './providers/types';
import { whatsappMediaUrl } from './providers/whatsapp';

/*
 * Customers' media, copied into our private `social-media` bucket (ADR-065): the platforms' own
 * links expire within days, and a chat history that loses its pictures looks broken. The
 * download address comes from a provider payload, so it is treated as untrusted: HTTPS only, the
 * platforms' own media hosts only, redirects followed by hand and checked at every hop, a size
 * cap, and the file's leading bytes must match a type we accept. WhatsApp files need the
 * account's token as well (ADR-066): it is sent only to Meta's own file hosts, at every hop.
 */

export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

/** Media hosts the platforms serve attachments and profile pictures from. */
const MEDIA_HOSTS = [
  'fbcdn.net',
  'fbsbx.com',
  'cdninstagram.com',
  'facebook.com',
  'instagram.com',
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktokv.com',
  'tiktok.com',
  'ibyteimg.com',
  'byteimg.com',
  'ibytedtos.com',
  'whatsapp.net',
];

/** Meta's hosts that serve WhatsApp files: the only places the account's token is ever sent. */
const TOKEN_HOSTS = ['fbsbx.com', 'facebook.com', 'whatsapp.net'];

const onHosts = (url: URL, hosts: string[]) => {
  const host = url.hostname.toLowerCase();
  return hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
};

const OFFICE_ZIP = (b: Uint8Array) => starts(b, [0x50, 0x4b, 0x03, 0x04]);
const TYPES: Record<string, { ext: string; matches: (bytes: Uint8Array) => boolean }> = {
  'image/jpeg': { ext: 'jpg', matches: (b) => starts(b, [0xff, 0xd8, 0xff]) },
  'image/png': { ext: 'png', matches: (b) => starts(b, [0x89, 0x50, 0x4e, 0x47]) },
  'image/gif': { ext: 'gif', matches: (b) => ascii(b, 0, 'GIF8') },
  'image/webp': { ext: 'webp', matches: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP') },
  'image/heic': { ext: 'heic', matches: (b) => ascii(b, 4, 'ftyp') },
  'image/heif': { ext: 'heif', matches: (b) => ascii(b, 4, 'ftyp') },
  'video/mp4': { ext: 'mp4', matches: (b) => ascii(b, 4, 'ftyp') },
  'video/quicktime': { ext: 'mov', matches: (b) => ascii(b, 4, 'ftyp') || ascii(b, 4, 'moov') },
  'audio/mp4': { ext: 'm4a', matches: (b) => ascii(b, 4, 'ftyp') },
  'audio/aac': { ext: 'aac', matches: (b) => starts(b, [0xff]) && ((b[1] ?? 0) & 0xf0) === 0xf0 },
  'audio/mpeg': {
    ext: 'mp3',
    matches: (b) => ascii(b, 0, 'ID3') || (starts(b, [0xff]) && ((b[1] ?? 0) & 0xe0) === 0xe0),
  },
  'audio/ogg': { ext: 'ogg', matches: (b) => ascii(b, 0, 'OggS') },
  'audio/wav': { ext: 'wav', matches: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE') },
  'application/pdf': { ext: 'pdf', matches: (b) => ascii(b, 0, '%PDF-') },
  // Office files customers send on WhatsApp. Their bytes start like any zip, so the declared
  // type must say which; they are never sniffed from the bytes alone.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    ext: 'docx',
    matches: OFFICE_ZIP,
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    ext: 'xlsx',
    matches: OFFICE_ZIP,
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    ext: 'pptx',
    matches: OFFICE_ZIP,
  },
};

const ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'audio/x-wav': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'audio/x-m4a': 'audio/mp4',
};

function starts(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
  return [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
}

/** True for an https address on one of the platforms' media hosts. */
export function allowedMediaUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  return onHosts(url, MEDIA_HOSTS);
}

/** The accepted type for these bytes and declared content type, or null. */
export function acceptedType(
  declared: string | null,
  bytes: Uint8Array,
): { mimeType: string; ext: string } | null {
  const base = (declared ?? '').split(';')[0]!.trim().toLowerCase();
  const mimeType = ALIASES[base] ?? base;
  const type = TYPES[mimeType];
  if (type?.matches(bytes)) return { mimeType, ext: type.ext };
  // Some CDNs label everything application/octet-stream: trust the bytes alone, for the
  // types whose signature is unambiguous.
  if (!type) {
    for (const candidate of [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
    ]) {
      const known = TYPES[candidate]!;
      if (known.matches(bytes)) return { mimeType: candidate, ext: known.ext };
    }
  }
  return null;
}

export class MediaRefused extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'MediaRefused';
  }
}

/** Reads at most `limit` bytes of a response body. */
async function readCapped(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > limit) throw new MediaRefused('too large');
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new MediaRefused('too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Downloads one media file from a platform's host, refusing anything outside the rules. A
 * `bearer` token goes only to Meta's WhatsApp file hosts, checked again at every redirect.
 */
export async function downloadMedia(
  url: string,
  options: { limit?: number; imagesOnly?: boolean; bearer?: string } = {},
): Promise<{ bytes: Uint8Array; mimeType: string; ext: string }> {
  let current = url;
  for (let hop = 0; hop < 4; hop += 1) {
    if (!allowedMediaUrl(current)) throw new MediaRefused('host not allowed');
    const withToken = options.bearer && onHosts(new URL(current), TOKEN_HOSTS);
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
        cache: 'no-store',
        ...(withToken ? { headers: { authorization: `Bearer ${options.bearer}` } } : {}),
      });
    } catch {
      throw new MediaRefused('unreachable');
    }
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location');
      if (!next) throw new MediaRefused('redirect without location');
      current = new URL(next, current).toString();
      continue;
    }
    if (!response.ok) throw new MediaRefused(`status ${response.status}`);
    const bytes = await readCapped(response, options.limit ?? MAX_MEDIA_BYTES);
    const type = acceptedType(response.headers.get('content-type'), bytes);
    if (!type || (options.imagesOnly && !type.mimeType.startsWith('image/'))) {
      throw new MediaRefused('type not accepted');
    }
    return { bytes, ...type };
  }
  throw new MediaRefused('too many redirects');
}

export type StoredAttachment = {
  type: string;
  state?: 'pending' | 'stored' | 'failed' | 'skipped';
  /** A WhatsApp history message whose file had not arrived yet. */
  placeholder?: boolean;
  storagePath?: string;
  mimeType?: string;
  size?: number;
  url?: string;
  mediaId?: string;
};

/** A transaction under RLS (import) or the privileged client (webhooks): both write the same. */
type Db = Pick<Tx, 'select' | 'update' | 'transaction'>;

/** What reaching a TikTok or WhatsApp attachment needs: the account and a usable token. */
export type MediaAccess = { account: AccountRef; token: string } | null;

/**
 * Copies every attachment of these messages that is not stored yet into the bucket and records
 * where it went. One message at a time, its row locked (`skip locked`, so a retried webhook
 * running alongside simply moves on). A refused or failed file is marked and keeps its link, so
 * the thread still shows that something was sent.
 */
export async function persistMessageMedia(
  db: Db,
  messageIds: string[],
  access: MediaAccess,
): Promise<{ stored: number; failed: number }> {
  let stored = 0;
  let failed = 0;
  for (const messageId of messageIds) {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: socialMessages.id,
          tenantId: socialMessages.tenantId,
          conversationId: socialMessages.conversationId,
          externalId: socialMessages.externalId,
          attachments: socialMessages.attachments,
          conversationExternalId: socialConversations.externalId,
        })
        .from(socialMessages)
        .innerJoin(
          socialConversations,
          and(
            eq(socialConversations.tenantId, socialMessages.tenantId),
            eq(socialConversations.id, socialMessages.conversationId),
          ),
        )
        .where(eq(socialMessages.id, messageId))
        .limit(1)
        .for('update', { of: socialMessages, skipLocked: true });
      if (!row || !Array.isArray(row.attachments)) return;
      const attachments = row.attachments as StoredAttachment[];
      let changed = false;
      const next: StoredAttachment[] = [];
      for (const [index, attachment] of attachments.entries()) {
        if (attachment.state === 'stored' || attachment.state === 'skipped') {
          next.push(attachment);
          continue;
        }
        try {
          const source = await sourceUrl(attachment, row, access);
          if (!source) {
            next.push({ ...attachment, state: 'skipped' });
            changed = true;
            continue;
          }
          const file = await downloadMedia(source.url, { bearer: source.bearer });
          const path = `${row.tenantId}/social/${row.conversationId}/${row.id}/${index}-${randomUUID()}.${file.ext}`;
          await writeSocialMedia(path, file.bytes, file.mimeType);
          next.push({
            type: attachment.type,
            state: 'stored',
            storagePath: path,
            mimeType: file.mimeType,
            size: file.bytes.byteLength,
          });
          stored += 1;
        } catch (error) {
          const refused = error instanceof MediaRefused && error.message === 'type not accepted';
          next.push({ ...attachment, state: refused ? 'skipped' : 'failed' });
          failed += 1;
        }
        changed = true;
      }
      if (changed) {
        await tx
          .update(socialMessages)
          .set({ attachments: next })
          .where(and(eq(socialMessages.tenantId, row.tenantId), eq(socialMessages.id, row.id)));
      }
    });
  }
  return { stored, failed };
}

async function sourceUrl(
  attachment: StoredAttachment,
  row: { externalId: string | null; conversationExternalId: string | null },
  access: MediaAccess,
): Promise<{ url: string; bearer?: string } | null> {
  if (attachment.url) return { url: attachment.url };
  if (!attachment.mediaId || !access) return null;
  try {
    if (access.account.platform === 'whatsapp') {
      const url = await whatsappMediaUrl(
        access.token,
        attachment.mediaId,
        access.account.externalId,
      );
      return { url, bearer: access.token };
    }
    if (access.account.platform !== 'tiktok') return null;
    if (!row.externalId || !row.conversationExternalId) return null;
    const type =
      attachment.type === 'video' ? 'VIDEO' : attachment.type === 'image' ? 'IMAGE' : null;
    if (!type) return null;
    return {
      url: await tiktokMediaUrl(
        access.account,
        access.token,
        row.conversationExternalId,
        row.externalId,
        attachment.mediaId,
        type,
      ),
    };
  } catch (error) {
    if (error instanceof ProviderError) throw new MediaRefused(error.message);
    throw error;
  }
}

/** Saves the customer's picture and records it on the conversation; best effort. */
export async function persistAvatar(
  db: Db,
  conversation: { id: string; tenantId: string },
  url: string,
): Promise<boolean> {
  try {
    const file = await downloadMedia(url, { limit: 5 * 1024 * 1024, imagesOnly: true });
    const path = `${conversation.tenantId}/social/avatars/${conversation.id}-${randomUUID()}.${file.ext}`;
    await writeSocialMedia(path, file.bytes, file.mimeType);
    await db
      .update(socialConversations)
      .set({ participantAvatarPath: path })
      .where(
        and(
          eq(socialConversations.tenantId, conversation.tenantId),
          eq(socialConversations.id, conversation.id),
          sql`${socialConversations.participantAvatarPath} is null`,
        ),
      );
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs slow work after the response is sent (Meta wants its webhook answered within seconds),
 * through Next.js `after`. Outside a request, as in tests or scripts, it simply runs now.
 */
export async function afterResponse(task: () => Promise<unknown>): Promise<void> {
  const safe = async () => {
    try {
      await task();
    } catch (error) {
      console.error(
        '[social] background media work failed',
        error instanceof Error ? error.name : typeof error,
      );
    }
  };
  try {
    after(safe);
  } catch {
    await safe();
  }
}
