import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';

import {
  contacts,
  socialAccounts,
  socialConversations,
  socialMessages,
  socialMessageTemplates,
} from '@/db/schema';
import { addDaysToDate, mondayOf, zonedDateTimeToInstant, zonedToday } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { scopeFilter } from '@/lib/permissions/scope';
import { contactScope } from '@/modules/contacts/access';
import { listMemberIdsWithPermission } from '@/modules/members/queries';
import { notify } from '@/modules/notifications/service';
import { audit } from '@/server/audit';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';
import {
  createSocialUploadTicket,
  readSocialMedia,
  removeSocialMedia,
  socialMediaLinkForPlatform,
} from '@/server/storage';

import { readCredentials, storeCredentials, usableToken, type Credentials } from './credentials';
import { sendEmailReply } from './email-service';
import { emailInboxConfigured } from './providers/resend';
import { recordImportedConversation } from './ingest';
import {
  acceptedType,
  afterResponse,
  persistMessageMedia,
  type MediaAccess,
  type StoredAttachment,
} from './media';
import type { OAuthProvider } from './oauth-state-keys';
import {
  discoverMetaAccounts,
  exchangeMetaCode,
  fetchMetaConversations,
  markMessengerSeen,
  sendMetaAttachment,
  sendMetaMessage,
  subscribeMetaAccount,
  unsubscribeMetaAccount,
} from './providers/meta';
import {
  exchangeTikTokCode,
  fetchTikTokConversations,
  sendTikTokImage,
  sendTikTokMessage,
  uploadTikTokImage,
} from './providers/tiktok';
import {
  markWhatsAppRead,
  sendWhatsAppMedia,
  sendWhatsAppTemplate,
  sendWhatsAppText,
  unsubscribeWhatsAppAccount,
  uploadWhatsAppMedia,
  type TemplateSend,
} from './providers/whatsapp';
import {
  previewOf,
  ProviderError,
  type AccountRef,
  type DiscoveredAccount,
  type SocialPlatform,
} from './providers/types';
import type {
  AssignInput,
  MediaReplyInput,
  ReplyInput,
  SnoozeInput,
  TemplateReplyInput,
} from './schemas';

const HOUR = 3_600_000;

/** How long after the customer's last message each platform lets a business reply. */
export const REPLY_RULES: Record<
  SocialPlatform,
  { normalHours: number; humanAgentHours: number | null; maxChars: number; maxBytes?: number }
> = {
  facebook: { normalHours: 24, humanAgentHours: 7 * 24, maxChars: 2000 },
  instagram: { normalHours: 24, humanAgentHours: 7 * 24, maxChars: 1000, maxBytes: 1000 },
  tiktok: { normalHours: 48, humanAgentHours: null, maxChars: 6000 },
  whatsapp: { normalHours: 24, humanAgentHours: null, maxChars: 4096 },
  // Email has no reply window (ADR-070).
  email: { normalHours: Number.POSITIVE_INFINITY, humanAgentHours: null, maxChars: 20000 },
  // Live chat has no reply window either (ADR-072); the visitor reads replies in the widget.
  livechat: { normalHours: Number.POSITIVE_INFINITY, humanAgentHours: null, maxChars: 2000 },
};

const PLATFORM_NAMES: Record<SocialPlatform, string> = {
  facebook: 'Messenger',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  email: 'Email',
  livechat: 'Live chat',
};

/** Whether a reply may go now, and whether it needs the human agent tag; or why not. */
export function replyWindow(
  platform: SocialPlatform,
  lastInboundAt: Date | null,
  now = new Date(),
): { ok: true; humanAgent: boolean } | { ok: false; reason: string } {
  if (!lastInboundAt) {
    return { ok: false, reason: 'You can reply once the customer has written to you.' };
  }
  const rules = REPLY_RULES[platform];
  const age = now.getTime() - lastInboundAt.getTime();
  if (age <= rules.normalHours * HOUR) return { ok: true, humanAgent: false };
  if (rules.humanAgentHours !== null && age <= rules.humanAgentHours * HOUR) {
    return { ok: true, humanAgent: true };
  }
  const limit = rules.humanAgentHours ?? rules.normalHours;
  return {
    ok: false,
    reason:
      platform === 'whatsapp'
        ? 'The customer last wrote more than 24 hours ago. WhatsApp only allows an approved template until they write again.'
        : `The customer last wrote more than ${limit >= 48 ? `${limit / 24} days` : `${limit} hours`} ago. ${
            PLATFORM_NAMES[platform]
          } only allows a reply after they write again.`,
  };
}

/**
 * When the platform's reply windows close, for the countdown in the reply box (ADR-067): the
 * normal window, and on Messenger and Instagram the 7 days a person may still answer in.
 */
export function windowEnds(
  platform: SocialPlatform,
  lastInboundAt: Date | null,
): { normal: Date | null; human: Date | null } {
  if (!lastInboundAt) return { normal: null, human: null };
  const rules = REPLY_RULES[platform];
  if (!Number.isFinite(rules.normalHours)) return { normal: null, human: null };
  const at = (hours: number) => new Date(lastInboundAt.getTime() + hours * HOUR);
  return {
    normal: at(rules.normalHours),
    human: rules.humanAgentHours === null ? null : at(rules.humanAgentHours),
  };
}

const MB = 1024 * 1024;
const OFFICE = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
} as const;

/**
 * What each platform takes in a reply (ADR-067), by type, with the largest size Meroidea sends.
 * WhatsApp: images 5 MB, video and audio 16 MB, documents. Messenger: images, video, audio and
 * files. Instagram: JPEG/PNG up to 8 MB, video, audio and PDF only. TikTok: JPG/PNG up to 3 MB.
 */
export const MEDIA_RULES: Record<SocialPlatform, Record<string, number>> = {
  whatsapp: {
    'image/jpeg': 5 * MB,
    'image/png': 5 * MB,
    'video/mp4': 16 * MB,
    'audio/mpeg': 16 * MB,
    'audio/mp4': 16 * MB,
    'audio/ogg': 16 * MB,
    'audio/aac': 16 * MB,
    ...Object.fromEntries(Object.keys(OFFICE).map((type) => [type, 16 * MB])),
  },
  facebook: {
    'image/jpeg': 16 * MB,
    'image/png': 16 * MB,
    'image/gif': 16 * MB,
    'video/mp4': 16 * MB,
    'audio/mpeg': 16 * MB,
    'audio/mp4': 16 * MB,
    ...Object.fromEntries(Object.keys(OFFICE).map((type) => [type, 16 * MB])),
  },
  instagram: {
    'image/jpeg': 8 * MB,
    'image/png': 8 * MB,
    'video/mp4': 16 * MB,
    'video/quicktime': 16 * MB,
    'audio/mp4': 16 * MB,
    'audio/aac': 16 * MB,
    'audio/wav': 16 * MB,
    'application/pdf': 16 * MB,
  },
  tiktok: { 'image/jpeg': 3 * MB, 'image/png': 3 * MB },
  // Resend takes 40 MB per email after base64; one file of up to 10 MB stays well inside it.
  email: {
    'image/jpeg': 10 * MB,
    'image/png': 10 * MB,
    'image/gif': 10 * MB,
    'image/webp': 10 * MB,
    ...Object.fromEntries(Object.keys(OFFICE).map((type) => [type, 10 * MB])),
  },
  // No files in live chat yet: the widget would need its own private file links.
  livechat: {},
};

/** WhatsApp and email send words with a photo, video or document in one message. */
export const CAPTIONS: Record<SocialPlatform, boolean> = {
  whatsapp: true,
  facebook: false,
  instagram: false,
  tiktok: false,
  email: true,
  livechat: false,
};

/** Why this file cannot go on this platform, or null when it can. */
export function mediaRefusal(
  platform: SocialPlatform,
  mimeType: string,
  size: number,
): string | null {
  const limit = MEDIA_RULES[platform][mimeType];
  if (!limit) return `${PLATFORM_NAMES[platform]} does not take this kind of file from here.`;
  if (size > limit) {
    return `${PLATFORM_NAMES[platform]} takes files of this kind up to ${Math.round(limit / MB)} MB.`;
  }
  return null;
}

export const mediaKind = (mimeType: string): 'image' | 'video' | 'audio' | 'file' =>
  mimeType.startsWith('image/')
    ? 'image'
    : mimeType.startsWith('video/')
      ? 'video'
      : mimeType.startsWith('audio/')
        ? 'audio'
        : 'file';

const describe = (error: unknown) =>
  error instanceof ProviderError ? error.message : 'Something went wrong on our side.';

async function discover(
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
): Promise<DiscoveredAccount[]> {
  if (provider === 'meta') return discoverMetaAccounts(await exchangeMetaCode(code, redirectUri));
  return [await exchangeTikTokCode(code, redirectUri)];
}

async function fetchHistory(account: AccountRef, token: string) {
  return account.platform === 'tiktok'
    ? fetchTikTokConversations(account, token)
    : fetchMetaConversations(account, token);
}

/**
 * Finishes connecting after the business logged in with Meta or TikTok: every account it shared
 * is saved with its sealed token, subscribed to our webhook and its recent conversations
 * imported. An account already live in another business is left alone (one business per
 * account, so a message has one place to go); the business is told only that it was skipped.
 */
export async function connectAccounts(
  ctx: TenantContext,
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
): Promise<{ connected: number; skipped: number; failed: number }> {
  requirePermission(ctx, 'social.manage');
  const discovered = await discover(provider, code, redirectUri);
  let connected = 0;
  let skipped = 0;
  let failed = 0;

  for (const found of discovered) {
    let accountId: string;
    try {
      accountId = await withRls(ctx, async (tx) => {
        // Connecting an account again, even after a disconnect, continues its history.
        const [existing] = await tx
          .select({ id: socialAccounts.id })
          .from(socialAccounts)
          .where(
            and(
              eq(socialAccounts.tenantId, ctx.tenantId),
              eq(socialAccounts.platform, found.platform),
              eq(socialAccounts.externalId, found.externalId),
            ),
          )
          .orderBy(desc(socialAccounts.connectedAt))
          .limit(1);
        const details = {
          name: found.name,
          username: found.username,
          avatarUrl: found.avatarUrl,
          providerBusinessId: found.providerBusinessId,
          status: 'active',
          lastError: null,
          disconnectedAt: null,
          updatedAt: new Date(),
        };
        let id = existing?.id;
        if (id) {
          await tx
            .update(socialAccounts)
            .set(details)
            .where(and(eq(socialAccounts.tenantId, ctx.tenantId), eq(socialAccounts.id, id)));
        } else {
          const [row] = await tx
            .insert(socialAccounts)
            .values({
              ...details,
              tenantId: ctx.tenantId,
              platform: found.platform,
              externalId: found.externalId,
              connectedBy: ctx.userId,
            })
            .returning({ id: socialAccounts.id });
          id = row!.id;
        }
        await storeCredentials(tx, ctx.tenantId, id, found);
        await audit(tx, ctx, {
          action: existing ? 'update' : 'create',
          entityType: 'social_account',
          entityId: id,
          context: { platform: found.platform, reconnected: Boolean(existing) },
        });
        return id;
      });
    } catch (error) {
      // The live-account index: this account is connected to another business.
      if ((error as { cause?: { code?: string } }).cause?.code === '23505') {
        skipped += 1;
        continue;
      }
      throw error;
    }

    const ref: AccountRef = {
      platform: found.platform,
      externalId: found.externalId,
      username: found.username,
    };
    let lastError: string | null = null;
    try {
      if (found.platform !== 'tiktok') await subscribeMetaAccount(ref, found.accessToken);
      const history = await fetchHistory(ref, found.accessToken);
      const withMedia = await withRls(ctx, async (tx) => {
        const ids: string[] = [];
        for (const conversation of history) {
          const result = await recordImportedConversation(
            tx,
            { tenantId: ctx.tenantId, accountId },
            conversation,
          );
          ids.push(...result.withMedia);
        }
        return ids;
      });
      if (withMedia.length > 0) {
        // Copying the imported media into storage can take a while: after the person is back
        // on the accounts page, still as them and under RLS.
        const access: MediaAccess =
          found.platform === 'tiktok' ? { account: ref, token: found.accessToken } : null;
        await afterResponse(() => withRls(ctx, (tx) => persistMessageMedia(tx, withMedia, access)));
      }
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      lastError = describe(error);
      failed += 1;
    }
    await withRls(ctx, (tx) =>
      tx
        .update(socialAccounts)
        .set({ lastSyncedAt: new Date(), lastError, updatedAt: new Date() })
        .where(and(eq(socialAccounts.tenantId, ctx.tenantId), eq(socialAccounts.id, accountId))),
    );
    connected += 1;
  }
  return { connected, skipped, failed };
}

async function liveAccount(ctx: TenantContext, accountId: string) {
  return withRls(ctx, async (tx) => {
    const [account] = await tx
      .select()
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.tenantId, ctx.tenantId),
          eq(socialAccounts.id, accountId),
          isNull(socialAccounts.disconnectedAt),
        ),
      )
      .limit(1);
    if (!account) throw new AppError('NOT_FOUND', 'That account is not connected.');
    const credentials = await readCredentials(tx, ctx.tenantId, account.id);
    return { account, credentials };
  });
}

/**
 * Disconnects an account: the provider stops sending its messages, its tokens are forgotten, and
 * the conversations so far stay as the business's record.
 */
export async function disconnectAccount(ctx: TenantContext, accountId: string): Promise<void> {
  requirePermission(ctx, 'social.manage');
  const { account, credentials } = await liveAccount(ctx, accountId);
  const wabaId = account.platform === 'whatsapp' ? account.providerBusinessId : null;
  if (credentials && wabaId) {
    // The webhook is per WhatsApp Business Account: keep it while another of its numbers is live.
    const others = await withRls(ctx, (tx) =>
      tx
        .select({ id: socialAccounts.id })
        .from(socialAccounts)
        .where(
          and(
            eq(socialAccounts.tenantId, ctx.tenantId),
            eq(socialAccounts.platform, 'whatsapp'),
            eq(socialAccounts.providerBusinessId, wabaId),
            isNull(socialAccounts.disconnectedAt),
            ne(socialAccounts.id, account.id),
          ),
        )
        .limit(1),
    );
    if (others.length === 0) {
      await unsubscribeWhatsAppAccount(credentials.accessToken, wabaId).catch(() => undefined);
    }
  } else if (credentials && (account.platform === 'facebook' || account.platform === 'instagram')) {
    // Best effort: a token that no longer works cannot unsubscribe, and Meta stops on its own.
    await unsubscribeMetaAccount(
      {
        platform: account.platform as SocialPlatform,
        externalId: account.externalId,
        username: null,
      },
      credentials.accessToken,
    ).catch(() => undefined);
  }
  await withRls(ctx, async (tx) => {
    await tx.execute(sql`select app.social_clear_credentials(${account.id}::uuid)`);
    await tx
      .update(socialAccounts)
      .set({ status: 'disconnected', disconnectedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(socialAccounts.tenantId, ctx.tenantId), eq(socialAccounts.id, account.id)));
    await audit(tx, ctx, {
      action: 'delete',
      entityType: 'social_account',
      entityId: account.id,
      context: { platform: account.platform },
    });
  });
}

type Prepared = {
  conversation: typeof socialConversations.$inferSelect;
  account: typeof socialAccounts.$inferSelect;
  platform: SocialPlatform;
  humanAgent: boolean;
  /** Empty for email, which sends through the platform's own Resend account (ADR-070). */
  credentials: Credentials | null;
  messageId: string;
  body: string;
  /** WhatsApp: send as this approved template instead of free text. */
  template: TemplateSend | null;
  /** A photo, video, voice note or file from the private bucket; `body` is its caption. */
  media: OutboundMedia | null;
};

type OutboundMedia = { path: string; mimeType: string; size: number; fileName: string };

/**
 * Everything a reply must pass before it goes: a live account, the platform's length and reply
 * window (and TikTok's ten replies per window), and usable tokens. Runs inside the caller's
 * transaction; `excluding` leaves a retried message out of TikTok's count. A WhatsApp template
 * may go at any time, so it skips the window and length checks.
 */
async function checkReply(
  tx: Tx,
  ctx: TenantContext,
  conversationId: string,
  body: string,
  now: Date,
  excluding?: string,
  options: { template?: boolean } = {},
) {
  const [row] = await tx
    .select({ conversation: socialConversations, account: socialAccounts })
    .from(socialConversations)
    .innerJoin(
      socialAccounts,
      and(
        eq(socialAccounts.tenantId, socialConversations.tenantId),
        eq(socialAccounts.id, socialConversations.accountId),
      ),
    )
    .where(
      and(
        eq(socialConversations.tenantId, ctx.tenantId),
        eq(socialConversations.id, conversationId),
      ),
    )
    .limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'That conversation was not found.');
  const { conversation, account } = row;
  const platform = account.platform as SocialPlatform;
  if (account.disconnectedAt) {
    throw new AppError('CONFLICT', 'This account is disconnected. Connect it again to reply.');
  }
  const rules = REPLY_RULES[platform];
  if (options.template && platform !== 'whatsapp') {
    throw new AppError('VALIDATION', 'Templates are for WhatsApp conversations.');
  }
  if (options.template) {
    const credentials = await readCredentials(tx, ctx.tenantId, account.id);
    if (!credentials) {
      throw new AppError(
        'CONFLICT',
        'This account needs to be connected again before you can reply.',
      );
    }
    return { conversation, account, platform, humanAgent: false, credentials };
  }
  if (
    body.length > rules.maxChars ||
    (rules.maxBytes && Buffer.byteLength(body) > rules.maxBytes)
  ) {
    throw new AppError(
      'VALIDATION',
      `Replies on this platform can be at most ${rules.maxChars} characters.`,
    );
  }
  const window = replyWindow(platform, conversation.lastInboundAt, now);
  if (!window.ok) throw new AppError('WINDOW_EXPIRED', window.reason);
  if (platform === 'tiktok' && conversation.lastInboundAt) {
    // TikTok allows ten messages in the 48 hours after each message from the customer.
    const [sent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(socialMessages)
      .where(
        and(
          eq(socialMessages.tenantId, ctx.tenantId),
          eq(socialMessages.conversationId, conversation.id),
          eq(socialMessages.direction, 'outbound'),
          inArray(socialMessages.status, ['sending', 'sent', 'delivered', 'read']),
          gte(socialMessages.sentAt, conversation.lastInboundAt),
          excluding ? ne(socialMessages.id, excluding) : undefined,
        ),
      );
    if ((sent?.n ?? 0) >= 10) {
      throw new AppError('CONFLICT', 'TikTok allows ten replies until the customer writes again.');
    }
  }
  if (platform === 'livechat') {
    // The visitor reads replies in the widget (ADR-072): nothing to send through a provider.
    return { conversation, account, platform, humanAgent: false, credentials: null };
  }
  if (platform === 'email') {
    if (!emailInboxConfigured()) {
      throw new AppError('CONFLICT', 'Email is not set up on this platform yet.');
    }
    if (!conversation.participantEmail) {
      throw new AppError('CONFLICT', 'This conversation has no email address to reply to.');
    }
    return { conversation, account, platform, humanAgent: false, credentials: null };
  }
  const credentials = await readCredentials(tx, ctx.tenantId, account.id);
  if (!credentials) {
    throw new AppError(
      'CONFLICT',
      'This account needs to be connected again before you can reply.',
    );
  }
  return { conversation, account, platform, humanAgent: window.humanAgent, credentials };
}

/**
 * Sends a reply from Meroidea. The message is stored as "sending" first, so a webhook echo that
 * arrives before the provider's answer finds it instead of adding a copy; it then becomes sent
 * or failed, with the provider's reason.
 */
export async function replyToConversation(
  ctx: TenantContext,
  input: ReplyInput,
  now = new Date(),
): Promise<{ messageId: string }> {
  requirePermission(ctx, 'social.reply');
  const prepared = await withRls(ctx, async (tx): Promise<Prepared> => {
    const checked = await checkReply(tx, ctx, input.conversationId, input.body, now);
    const [pending] = await tx
      .insert(socialMessages)
      .values({
        tenantId: ctx.tenantId,
        conversationId: checked.conversation.id,
        accountId: checked.account.id,
        direction: 'outbound',
        body: input.body,
        sentAt: now,
        sentByUserId: ctx.userId,
        status: 'sending',
      })
      .returning({ id: socialMessages.id });
    return { ...checked, messageId: pending!.id, body: input.body, template: null, media: null };
  });
  return deliver(ctx, prepared, now, 'create');
}

/** A template's body with the values in place of its placeholders, as the customer sees it. */
export function renderTemplate(body: string, parameters: string[], values: string[]): string {
  return body.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (whole, name: string) => {
    const index = parameters.indexOf(name);
    return index >= 0 && values[index] !== undefined ? values[index]! : whole;
  });
}

/**
 * Sends an approved WhatsApp template, the only kind of message WhatsApp allows more than 24
 * hours after the customer last wrote. Meta charges the business for it (ADR-066).
 */
export async function sendTemplateReply(
  ctx: TenantContext,
  input: TemplateReplyInput,
  now = new Date(),
): Promise<{ messageId: string }> {
  requirePermission(ctx, 'social.reply');
  const prepared = await withRls(ctx, async (tx): Promise<Prepared> => {
    const [template] = await tx
      .select()
      .from(socialMessageTemplates)
      .where(
        and(
          eq(socialMessageTemplates.tenantId, ctx.tenantId),
          eq(socialMessageTemplates.id, input.templateId),
        ),
      )
      .limit(1);
    if (!template) throw new AppError('NOT_FOUND', 'That template was not found.');
    if (template.status !== 'approved' || !template.sendable) {
      throw new AppError('CONFLICT', 'Only an approved template can be sent from here.');
    }
    if (input.values.length !== template.parameters.length) {
      throw new AppError('VALIDATION', 'Fill in every value the template needs.');
    }
    const body = renderTemplate(template.body, template.parameters, input.values);
    const checked = await checkReply(tx, ctx, input.conversationId, body, now, undefined, {
      template: true,
    });
    if (checked.account.id !== template.accountId) {
      throw new AppError('VALIDATION', 'That template belongs to another WhatsApp number.');
    }
    const send: TemplateSend = {
      name: template.name,
      language: template.language,
      parameterFormat: template.parameterFormat === 'named' ? 'named' : 'positional',
      parameters: template.parameters,
      values: input.values,
    };
    const [pending] = await tx
      .insert(socialMessages)
      .values({
        tenantId: ctx.tenantId,
        conversationId: checked.conversation.id,
        accountId: checked.account.id,
        direction: 'outbound',
        body,
        template: send,
        sentAt: now,
        sentByUserId: ctx.userId,
        status: 'sending',
      })
      .returning({ id: socialMessages.id });
    return { ...checked, messageId: pending!.id, body, template: send, media: null };
  });
  return deliver(ctx, prepared, now, 'create');
}

/**
 * Sends a failed reply again, as the same message, once the reason has passed: a rate limit
 * lifted, the account reconnected, the customer written again. Every check runs afresh.
 */
export async function retryReply(
  ctx: TenantContext,
  messageId: string,
  now = new Date(),
): Promise<{ messageId: string }> {
  requirePermission(ctx, 'social.reply');
  const prepared = await withRls(ctx, async (tx): Promise<Prepared> => {
    const [failed] = await tx
      .select({
        id: socialMessages.id,
        conversationId: socialMessages.conversationId,
        body: socialMessages.body,
        template: socialMessages.template,
        attachments: socialMessages.attachments,
      })
      .from(socialMessages)
      .where(
        and(
          eq(socialMessages.tenantId, ctx.tenantId),
          eq(socialMessages.id, messageId),
          eq(socialMessages.direction, 'outbound'),
          eq(socialMessages.status, 'failed'),
        ),
      )
      .limit(1)
      .for('update');
    const media = outboundMediaOf(failed?.attachments);
    if (!failed || (!failed.body && !media)) {
      throw new AppError('NOT_FOUND', 'That reply was not found.');
    }
    const template = (failed.template as TemplateSend | null) ?? null;
    const checked = await checkReply(
      tx,
      ctx,
      failed.conversationId,
      failed.body ?? '',
      now,
      failed.id,
      { template: template !== null },
    );
    await tx
      .update(socialMessages)
      .set({ status: 'sending', error: null })
      .where(and(eq(socialMessages.tenantId, ctx.tenantId), eq(socialMessages.id, failed.id)));
    return { ...checked, messageId: failed.id, body: failed.body ?? '', template, media };
  });
  return deliver(ctx, prepared, now, 'update');
}

/** Calls the provider outside any transaction, then records the outcome. */
async function deliver(
  ctx: TenantContext,
  prepared: Prepared,
  now: Date,
  action: 'create' | 'update',
): Promise<{ messageId: string }> {
  const {
    conversation,
    account,
    platform,
    humanAgent,
    credentials,
    messageId,
    body,
    template,
    media,
  } = prepared;
  const ref: AccountRef = { platform, externalId: account.externalId, username: account.username };
  let externalId: string | null = null;
  let failure: ProviderError | null = null;
  let renewed: Credentials | null = null;
  try {
    if (platform === 'livechat') {
      externalId = `chat-out:${messageId}`;
    } else if (platform === 'email') {
      // A retry is a new attempt; the first send's key stops a doubled request sending twice.
      externalId = await sendEmailReply(
        ctx,
        prepared,
        action === 'create' ? `social-${messageId}` : `social-${messageId}-${now.getTime()}`,
      );
    } else {
      if (!credentials)
        throw new ProviderError(platform, 'This account needs to be connected again.');
      const usable = await usableToken(platform, credentials, now);
      renewed = usable.renewed;
      if (media) {
        externalId = await sendMedia(prepared, usable.token, media);
      } else if (platform === 'whatsapp') {
        externalId = template
          ? await sendWhatsAppTemplate(
              usable.token,
              account.externalId,
              conversation.participantId,
              template,
            )
          : await sendWhatsAppText(
              usable.token,
              account.externalId,
              conversation.participantId,
              body,
            );
      } else if (platform === 'tiktok') {
        externalId = await sendTikTokMessage(
          ref,
          usable.token,
          conversation.externalId ?? conversation.participantId,
          body,
        );
      } else {
        externalId = await sendMetaMessage(
          ref,
          usable.token,
          conversation.participantId,
          body,
          humanAgent,
        );
      }
    }
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    failure = error;
  }

  await withRls(ctx, async (tx) => {
    if (renewed) await storeCredentials(tx, ctx.tenantId, account.id, renewed);
    if (failure) {
      await tx
        .update(socialMessages)
        .set({ status: 'failed', error: failure.message })
        .where(and(eq(socialMessages.tenantId, ctx.tenantId), eq(socialMessages.id, messageId)));
      if (failure.reconnect) {
        await tx
          .update(socialAccounts)
          .set({ status: 'needs_reconnect', lastError: failure.message, updatedAt: new Date() })
          .where(and(eq(socialAccounts.tenantId, ctx.tenantId), eq(socialAccounts.id, account.id)));
      }
      return;
    }
    // A webhook echo may already have claimed the row and set its id.
    await tx
      .update(socialMessages)
      .set({ externalId, status: 'sent', sentAt: now })
      .where(
        and(
          eq(socialMessages.tenantId, ctx.tenantId),
          eq(socialMessages.id, messageId),
          isNull(socialMessages.externalId),
        ),
      );
    await tx
      .update(socialConversations)
      .set({
        lastMessageAt: now,
        lastMessagePreview: previewOf({
          body: body || null,
          attachments: media ? [{ type: mediaKind(media.mimeType) }] : [],
        }),
        unreadCount: 0,
        updatedAt: now,
      })
      .where(
        and(
          eq(socialConversations.tenantId, ctx.tenantId),
          eq(socialConversations.id, conversation.id),
        ),
      );
    await audit(tx, ctx, {
      action,
      entityType: 'social_message',
      entityId: messageId,
      context: {
        conversationId: conversation.id,
        platform,
        retried: action === 'update',
        ...(template ? { template: template.name } : {}),
        ...(media ? { media: mediaKind(media.mimeType) } : {}),
      },
    });
  });
  if (failure) throw replyFailure(failure);
  return { messageId };
}

/** The reason a reply was not sent, in words the person can act on. */
function replyFailure(failure: ProviderError): AppError {
  if (failure.rateLimited) {
    const wait = failure.retryAfterMinutes;
    return new AppError(
      'RATE_LIMITED',
      `Not sent yet: the platform is limiting messages right now. ${
        wait
          ? `Try again in about ${wait} ${wait === 1 ? 'minute' : 'minutes'}`
          : 'Try again in a few minutes'
      } with Retry.`,
    );
  }
  if (failure.reconnect) {
    return new AppError(
      'CONFLICT',
      'The account needs to be connected again: its authorisation no longer works.',
    );
  }
  return new AppError('CONFLICT', `Not sent: ${failure.message}`);
}

/** Links the customer to a CRM contact the person can see, or unlinks them. */
export async function linkConversationContact(
  ctx: TenantContext,
  input: { conversationId: string; contactId: string | null },
): Promise<void> {
  requirePermission(ctx, 'social.reply');
  if (input.contactId) requirePermission(ctx, 'contacts.view');
  await withRls(ctx, async (tx) => {
    const [conversation] = await tx
      .select({ id: socialConversations.id, contactId: socialConversations.contactId })
      .from(socialConversations)
      .where(
        and(
          eq(socialConversations.tenantId, ctx.tenantId),
          eq(socialConversations.id, input.conversationId),
        ),
      )
      .limit(1);
    if (!conversation) throw new AppError('NOT_FOUND', 'That conversation was not found.');
    if (input.contactId) {
      const [contact] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.tenantId, ctx.tenantId),
            eq(contacts.id, input.contactId),
            isNull(contacts.deletedAt),
            scopeFilter(ctx, 'contacts.view', contacts, contactScope),
          ),
        )
        .limit(1);
      if (!contact) throw new AppError('NOT_FOUND', 'That contact was not found.');
    }
    await tx
      .update(socialConversations)
      // A person's choice: automatic matching never changes it again (ADR-068).
      .set({ contactId: input.contactId, contactMatch: 'manual', updatedAt: new Date() })
      .where(
        and(
          eq(socialConversations.tenantId, ctx.tenantId),
          eq(socialConversations.id, conversation.id),
        ),
      );
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'social_conversation',
      entityId: conversation.id,
      changes: { contactId: [conversation.contactId, input.contactId] },
    });
  });
}

/** Marks a conversation done, or open again (which also ends a snooze). */
export async function setConversationStatus(
  ctx: TenantContext,
  input: { conversationId: string; status: 'open' | 'done' },
): Promise<void> {
  requirePermission(ctx, 'social.reply');
  await withRls(ctx, async (tx) => {
    const [before] = await tx
      .select({ id: socialConversations.id, status: socialConversations.status })
      .from(socialConversations)
      .where(
        and(
          eq(socialConversations.tenantId, ctx.tenantId),
          eq(socialConversations.id, input.conversationId),
        ),
      )
      .limit(1);
    if (!before) throw new AppError('NOT_FOUND', 'That conversation was not found.');
    await tx
      .update(socialConversations)
      .set({ status: input.status, snoozedUntil: null, updatedAt: new Date() })
      .where(
        and(eq(socialConversations.tenantId, ctx.tenantId), eq(socialConversations.id, before.id)),
      );
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'social_conversation',
      entityId: before.id,
      changes: { status: [before.status, input.status] },
    });
  });
}

/** The quick snooze choices, in the business's timezone (ADR-067). */
export function snoozeChoices(
  timeZone: string,
  now = new Date(),
): { label: string; until: string }[] {
  const today = zonedToday(timeZone, now);
  return [
    { label: 'In 3 hours', until: new Date(now.getTime() + 3 * HOUR).toISOString() },
    {
      label: 'Tomorrow 9 am',
      until: zonedDateTimeToInstant(timeZone, addDaysToDate(today, 1), '09:00').toISOString(),
    },
    {
      label: 'Next Monday 9 am',
      until: zonedDateTimeToInstant(
        timeZone,
        addDaysToDate(mondayOf(today), 7),
        '09:00',
      ).toISOString(),
    },
  ];
}

/** The longest a conversation may be snoozed. */
const MAX_SNOOZE_DAYS = 90;

/**
 * Sets a conversation aside until a time (ADR-067). It leaves the Open view and comes back on
 * its own when the time passes, or at once if the customer writes again.
 */
export async function snoozeConversation(
  ctx: TenantContext,
  input: SnoozeInput,
  now = new Date(),
): Promise<void> {
  requirePermission(ctx, 'social.reply');
  const until = new Date(input.until);
  if (until.getTime() <= now.getTime() + 60_000) {
    throw new AppError('VALIDATION', 'Choose a time in the future.');
  }
  if (until.getTime() > now.getTime() + MAX_SNOOZE_DAYS * 24 * HOUR) {
    throw new AppError(
      'VALIDATION',
      `A conversation can be snoozed for up to ${MAX_SNOOZE_DAYS} days.`,
    );
  }
  await withRls(ctx, async (tx) => {
    const [row] = await tx
      .update(socialConversations)
      .set({ status: 'snoozed', snoozedUntil: until, updatedAt: now })
      .where(
        and(
          eq(socialConversations.tenantId, ctx.tenantId),
          eq(socialConversations.id, input.conversationId),
        ),
      )
      .returning({ id: socialConversations.id });
    if (!row) throw new AppError('NOT_FOUND', 'That conversation was not found.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'social_conversation',
      entityId: row.id,
      changes: { snoozedUntil: [null, until.toISOString()] },
    });
  });
}

/**
 * Gives a conversation to a colleague who can read the inbox, or back to the whole team
 * (ADR-067). The colleague is told in Meroidea; what the customer wrote is never in the notice.
 */
export async function assignConversation(ctx: TenantContext, input: AssignInput): Promise<void> {
  requirePermission(ctx, 'social.reply');
  if (input.userId) {
    const allowed = await listMemberIdsWithPermission(ctx, 'social.view');
    if (!allowed.includes(input.userId)) {
      throw new AppError('VALIDATION', 'That colleague cannot see the social inbox.');
    }
  }
  await withRls(ctx, async (tx) => {
    const [row] = await tx
      .select({
        id: socialConversations.id,
        assignedUserId: socialConversations.assignedUserId,
        platform: socialAccounts.platform,
      })
      .from(socialConversations)
      .innerJoin(
        socialAccounts,
        and(
          eq(socialAccounts.tenantId, socialConversations.tenantId),
          eq(socialAccounts.id, socialConversations.accountId),
        ),
      )
      .where(
        and(
          eq(socialConversations.tenantId, ctx.tenantId),
          eq(socialConversations.id, input.conversationId),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('NOT_FOUND', 'That conversation was not found.');
    if (row.assignedUserId === input.userId) return;
    await tx
      .update(socialConversations)
      .set({ assignedUserId: input.userId, updatedAt: new Date() })
      .where(
        and(eq(socialConversations.tenantId, ctx.tenantId), eq(socialConversations.id, row.id)),
      );
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'social_conversation',
      entityId: row.id,
      changes: { assignedUserId: [row.assignedUserId, input.userId] },
    });
    if (input.userId) {
      await notify(tx, ctx, [
        {
          userId: input.userId,
          type: 'conversation_assigned',
          title: `A ${PLATFORM_NAMES[row.platform as SocialPlatform]} conversation was assigned to you`,
          url: `/social/${row.id}`,
          dedupeKey: `conversation_assigned:${row.id}:${Date.now()}`,
        },
      ]);
    }
  });
}

/**
 * Opening a conversation reads it. With new messages from the customer, and when the person may
 * reply, the platform is told too, after the page has its answer: WhatsApp's blue ticks and
 * Messenger's "seen" (ADR-067). Instagram and TikTok document no such call for businesses.
 */
export async function markConversationRead(
  ctx: TenantContext,
  conversationId: string,
): Promise<void> {
  requirePermission(ctx, 'social.view');
  const cleared = await withRls(ctx, (tx) =>
    tx
      .update(socialConversations)
      .set({ unreadCount: 0 })
      .where(
        and(
          eq(socialConversations.tenantId, ctx.tenantId),
          eq(socialConversations.id, conversationId),
          sql`${socialConversations.unreadCount} > 0`,
        ),
      )
      .returning({ id: socialConversations.id }),
  );
  if (cleared.length === 0 || !hasPermission(ctx, 'social.reply')) return;
  await afterResponse(() => sendReadReceipt(ctx, conversationId));
}

async function sendReadReceipt(ctx: TenantContext, conversationId: string): Promise<void> {
  const target = await withRls(ctx, async (tx) => {
    const [row] = await tx
      .select({
        platform: socialAccounts.platform,
        accountId: socialAccounts.id,
        externalId: socialAccounts.externalId,
        username: socialAccounts.username,
        disconnectedAt: socialAccounts.disconnectedAt,
        participantId: socialConversations.participantId,
        lastInboundAt: socialConversations.lastInboundAt,
      })
      .from(socialConversations)
      .innerJoin(
        socialAccounts,
        and(
          eq(socialAccounts.tenantId, socialConversations.tenantId),
          eq(socialAccounts.id, socialConversations.accountId),
        ),
      )
      .where(
        and(
          eq(socialConversations.tenantId, ctx.tenantId),
          eq(socialConversations.id, conversationId),
        ),
      )
      .limit(1);
    if (!row || row.disconnectedAt || !['whatsapp', 'facebook'].includes(row.platform)) return null;
    const [latest] = await tx
      .select({ externalId: socialMessages.externalId })
      .from(socialMessages)
      .where(
        and(
          eq(socialMessages.tenantId, ctx.tenantId),
          eq(socialMessages.conversationId, conversationId),
          eq(socialMessages.direction, 'inbound'),
        ),
      )
      .orderBy(desc(socialMessages.sentAt))
      .limit(1);
    const credentials = await readCredentials(tx, ctx.tenantId, row.accountId);
    return credentials ? { ...row, latest: latest?.externalId ?? null, credentials } : null;
  });
  if (!target) return;
  const ref: AccountRef = {
    platform: target.platform as SocialPlatform,
    externalId: target.externalId,
    username: target.username,
  };
  try {
    if (target.platform === 'whatsapp' && target.latest) {
      await markWhatsAppRead(target.credentials.accessToken, target.externalId, target.latest);
    } else if (target.platform === 'facebook' && replyWindow('facebook', target.lastInboundAt).ok) {
      await markMessengerSeen(ref, target.credentials.accessToken, target.participantId);
    }
  } catch {
    // Best effort: a receipt that does not go changes nothing in Meroidea.
  }
}

/** A failed reply's own file, from its stored attachment. */
function outboundMediaOf(attachments: unknown): OutboundMedia | null {
  const first = Array.isArray(attachments)
    ? (attachments[0] as StoredAttachment | undefined)
    : undefined;
  if (!first || first.state !== 'stored' || !first.storagePath || !first.mimeType) return null;
  return {
    path: first.storagePath,
    mimeType: first.mimeType,
    size: first.size ?? 0,
    fileName: first.storagePath.split('/').pop() ?? 'file',
  };
}

/** Sends a photo, video, voice note or file on the conversation's platform. */
async function sendMedia(prepared: Prepared, token: string, media: OutboundMedia): Promise<string> {
  const { account, conversation, platform, humanAgent, body } = prepared;
  const ref: AccountRef = { platform, externalId: account.externalId, username: account.username };
  if (platform === 'facebook' || platform === 'instagram') {
    // Meta fetches the file from a ten-minute link while it delivers the message.
    const url = await socialMediaLinkForPlatform(media.path);
    return sendMetaAttachment(
      ref,
      token,
      conversation.participantId,
      { type: mediaKind(media.mimeType), url },
      humanAgent,
    );
  }
  const bytes = await readSocialMedia(media.path);
  if (!bytes)
    throw new ProviderError(platform, 'The file is no longer in storage. Attach it again.');
  const file = { bytes, mimeType: media.mimeType, fileName: media.fileName };
  if (platform === 'tiktok') {
    const mediaId = await uploadTikTokImage(ref, token, file);
    return sendTikTokImage(
      ref,
      token,
      conversation.externalId ?? conversation.participantId,
      mediaId,
    );
  }
  const kind = mediaKind(media.mimeType);
  const id = await uploadWhatsAppMedia(token, account.externalId, file);
  return sendWhatsAppMedia(token, account.externalId, conversation.participantId, {
    kind: kind === 'file' ? 'document' : kind,
    id,
    caption: body || null,
    fileName: media.fileName,
  });
}

/** Where a reply's attachment is uploaded: under the business and conversation, never chosen by the browser. */
const outboundPrefix = (tenantId: string, conversationId: string) =>
  `${tenantId}/social/${conversationId}/outbound/`;

/**
 * Starts attaching a file to a reply (ADR-067): checks the person may reply here and that the
 * platform takes this kind and size of file, then hands the browser a one-time upload ticket for
 * a path the server chose.
 */
export async function startMediaUpload(
  ctx: TenantContext,
  input: { conversationId: string; fileName: string; mimeType: string; size: number },
): Promise<{ path: string; token: string }> {
  requirePermission(ctx, 'social.reply');
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({ platform: socialAccounts.platform, disconnectedAt: socialAccounts.disconnectedAt })
      .from(socialConversations)
      .innerJoin(
        socialAccounts,
        and(
          eq(socialAccounts.tenantId, socialConversations.tenantId),
          eq(socialAccounts.id, socialConversations.accountId),
        ),
      )
      .where(
        and(
          eq(socialConversations.tenantId, ctx.tenantId),
          eq(socialConversations.id, input.conversationId),
        ),
      )
      .limit(1),
  );
  if (!row) throw new AppError('NOT_FOUND', 'That conversation was not found.');
  if (row.disconnectedAt) {
    throw new AppError('CONFLICT', 'This account is disconnected. Connect it again to reply.');
  }
  const refusal = mediaRefusal(row.platform as SocialPlatform, input.mimeType, input.size);
  if (refusal) throw new AppError('VALIDATION', refusal);
  const ext =
    (input.fileName.split('.').pop() ?? 'bin')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8) || 'bin';
  return createSocialUploadTicket(
    `${outboundPrefix(ctx.tenantId, input.conversationId)}${randomUUID()}.${ext}`,
  );
}

/**
 * Sends the uploaded attachment as a reply (ADR-067). The file is checked again here, where the
 * browser cannot interfere: the path must be this conversation's, the bytes must match an
 * accepted type the platform takes, and the size must fit. A refused file is deleted. Then the
 * same rules as text apply (account live, reply window, TikTok's ten replies) and it is sent.
 */
export async function sendMediaReply(
  ctx: TenantContext,
  input: MediaReplyInput,
  now = new Date(),
): Promise<{ messageId: string }> {
  requirePermission(ctx, 'social.reply');
  const prefix = outboundPrefix(ctx.tenantId, input.conversationId);
  if (!input.path.startsWith(prefix) || input.path.includes('..')) {
    throw new AppError('VALIDATION', 'That upload does not belong to this conversation.');
  }
  const bytes = await readSocialMedia(input.path);
  if (!bytes) throw new AppError('VALIDATION', 'The upload did not finish. Attach the file again.');
  const type = acceptedType(input.mimeType, bytes);
  const prepared = await withRls(ctx, async (tx): Promise<Prepared> => {
    const checked = await checkReply(tx, ctx, input.conversationId, input.caption ?? '', now);
    const refusal = !type
      ? 'That file is not the kind it says it is.'
      : mediaRefusal(checked.platform, type.mimeType, bytes.byteLength);
    if (refusal) {
      await removeSocialMedia([input.path]);
      throw new AppError('VALIDATION', refusal);
    }
    if (input.caption && !CAPTIONS[checked.platform]) {
      throw new AppError(
        'VALIDATION',
        `${PLATFORM_NAMES[checked.platform]} sends a file on its own: send the words as a separate reply.`,
      );
    }
    const kind = mediaKind(type!.mimeType);
    const [pending] = await tx
      .insert(socialMessages)
      .values({
        tenantId: ctx.tenantId,
        conversationId: checked.conversation.id,
        accountId: checked.account.id,
        direction: 'outbound',
        body: input.caption,
        attachments: [
          {
            type: kind,
            state: 'stored',
            storagePath: input.path,
            mimeType: type!.mimeType,
            size: bytes.byteLength,
          },
        ],
        sentAt: now,
        sentByUserId: ctx.userId,
        status: 'sending',
      })
      .returning({ id: socialMessages.id });
    return {
      ...checked,
      messageId: pending!.id,
      body: input.caption ?? '',
      template: null,
      media: {
        path: input.path,
        mimeType: type!.mimeType,
        size: bytes.byteLength,
        fileName: input.fileName,
      },
    };
  });
  return deliver(ctx, prepared, now, 'create');
}
