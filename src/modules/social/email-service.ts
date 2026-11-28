import 'server-only';

import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';

import { socialAccounts, socialConversations, socialMessages } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { escapeHtml } from '@/lib/html';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';
import { socialMediaLinkForPlatform } from '@/server/storage';

import { emailDocHtml, type EmailDoc } from './email-doc';
import { INBOX_LOCAL_PART, replyAddress, replySubject, reservedLocalPart } from './email-parse';
import { emailInboxConfigured, inboxDomain, sendResendEmail } from './providers/resend';
import type { EmailInboxInput } from './schemas';
import { ProviderError } from './providers/types';

/*
 * Replies from an email inbox (ADR-070). A reply is sent from the inbox's address with the
 * thread's own reply address (r-<token>@<inbox domain>) as Reply-To, so the customer's answer
 * comes back to this conversation whatever their mail program does with the headers; In-Reply-To
 * and References carry the thread's Message-IDs so it also threads in their mail program.
 */

/** How many earlier Message-IDs a reply's References names at most. */
const MAX_REFERENCES = 20;

type OutboundFile = { path: string; mimeType: string; size: number; fileName: string };

/** What Compose adds to an email beyond its words and its thread's person (ADR-090). */
export type ComposedEmail = {
  /** Every To address; the first is the thread's person. */
  to: string[];
  cc: string[];
  bcc: string[];
  doc: EmailDoc;
  attachments: OutboundFile[];
  /** Pictures in the text, sent as embedded attachments with these Content-IDs (ADR-091). */
  images: (OutboundFile & { contentId: string })[];
};

type EmailReply = {
  conversation: typeof socialConversations.$inferSelect;
  account: typeof socialAccounts.$inferSelect;
  messageId: string;
  body: string;
  media: OutboundFile | null;
  composed?: ComposedEmail | null;
};

/** A display name safe inside a From header: no quotes, angle brackets or line breaks. */
function headerName(name: string): string {
  return (
    name
      .replace(/["<>\r\n\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Support'
  );
}

export function emailHtml(body: string): string {
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">${escapeHtml(
    body,
  ).replace(/\r?\n/g, '<br>')}</div>`;
}

/** Sends the reply through Resend; returns its email id. Throws ProviderError when refused. */
export async function sendEmailReply(
  ctx: TenantContext,
  reply: EmailReply,
  attemptKey: string,
): Promise<string> {
  const { conversation, account } = reply;
  const domain = inboxDomain();
  if (!domain) throw new ProviderError('email', 'Email is not set up on this platform.');
  if (!conversation.participantEmail || !conversation.replyToken) {
    throw new ProviderError('email', 'This conversation has no email address to reply to.');
  }
  const thread = await withRls(ctx, (tx) =>
    tx
      .select({ id: socialMessages.emailMessageId, direction: socialMessages.direction })
      .from(socialMessages)
      .where(
        and(
          eq(socialMessages.tenantId, ctx.tenantId),
          eq(socialMessages.conversationId, conversation.id),
          isNotNull(socialMessages.emailMessageId),
        ),
      )
      .orderBy(asc(socialMessages.sentAt)),
  );
  const ids = thread.map((row) => row.id!).filter((id) => /^<[^<>\s]{3,250}>$/.test(id));
  const lastInbound = [...thread].reverse().find((row) => row.direction === 'inbound')?.id;
  const inReplyTo = lastInbound ?? ids[ids.length - 1];
  const headers: Record<string, string> = {};
  if (inReplyTo) {
    headers['In-Reply-To'] = inReplyTo;
    headers.References = ids.slice(-MAX_REFERENCES).join(' ');
  }
  // The first email of a thread the business started goes with its subject as written; anything
  // after a message in the thread (received, or sent and given a Message-ID) is a reply.
  const answering = Boolean(conversation.lastInboundAt) || ids.length > 0;
  const subject = answering
    ? replySubject(conversation.subject)
    : (conversation.subject ?? replySubject(null));
  const composed = reply.composed ?? null;
  const files: (OutboundFile & { contentId?: string })[] = composed
    ? [...composed.attachments, ...composed.images]
    : reply.media
      ? [reply.media]
      : [];
  const attachments = await Promise.all(
    files.map(async (file) => ({
      filename: file.fileName.slice(0, 120),
      // Resend fetches the file while sending: a ten-minute link to that one object.
      path: await socialMediaLinkForPlatform(file.path),
      content_type: file.mimeType,
      ...(file.contentId ? { content_id: file.contentId } : {}),
    })),
  );
  const cid = new Map(composed?.images.map((image) => [image.path, `cid:${image.contentId}`]));
  // Its Message-ID is recorded from Resend's "sent" event (webhooks.ts): sessions never write
  // email details, so an inbound message's sender checks cannot be altered.
  return sendResendEmail({
    from: `"${headerName(account.name)}" <${account.externalId}>`,
    to: composed && composed.to.length > 0 ? composed.to : [conversation.participantEmail],
    cc: composed?.cc ?? [],
    bcc: composed?.bcc ?? [],
    subject,
    text: reply.body,
    // Composed HTML is built here from the checked document, never taken from the browser.
    html: composed
      ? emailDocHtml(composed.doc, { imageSrc: (path) => cid.get(path) ?? null })
      : emailHtml(reply.body),
    replyTo: replyAddress(conversation.replyToken, domain),
    headers,
    attachments,
    idempotencyKey: attemptKey,
  });
}

/**
 * Creates an email inbox for the business (ADR-070): `<local part>@<inbox domain>`, which the
 * business publishes or forwards its own address to. Addresses are unique across the platform
 * while live, so a message has exactly one business to go to; the platform's own and reply
 * addresses cannot be taken.
 */
export async function createEmailInbox(
  ctx: TenantContext,
  input: EmailInboxInput,
): Promise<{ id: string; address: string }> {
  requirePermission(ctx, 'social.manage');
  const domain = inboxDomain();
  if (!domain || !emailInboxConfigured()) {
    throw new AppError(
      'CONFLICT',
      'Email is not set up on this platform yet. Ask the platform owner.',
    );
  }
  if (!INBOX_LOCAL_PART.test(input.localPart) || reservedLocalPart(input.localPart)) {
    throw new AppError('VALIDATION', 'That address cannot be used. Choose another.', {
      localPart: ['That address cannot be used. Choose another.'],
    });
  }
  const address = `${input.localPart}@${domain}`;
  try {
    return await withRls(ctx, async (tx) => {
      const [created] = await tx
        .insert(socialAccounts)
        .values({
          tenantId: ctx.tenantId,
          platform: 'email',
          externalId: address,
          name: input.name,
          username: address,
          connectedBy: ctx.userId,
        })
        .returning({ id: socialAccounts.id });
      if (!created) throw new AppError('INTERNAL', 'The inbox could not be created.');
      await tx.execute(
        sql`select app.social_set_account_settings(${created.id}::uuid, ${JSON.stringify({
          createLeadForUnknown: input.createLeadForUnknown,
        })}::jsonb)`,
      );
      await audit(tx, ctx, {
        action: 'create',
        entityType: 'social_account',
        entityId: created.id,
        context: { platform: 'email' },
      });
      return { id: created.id, address };
    });
  } catch (error) {
    const code =
      (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === '23505') {
      const message = 'That address is already taken. Choose another.';
      throw new AppError('DUPLICATE', message, { localPart: [message] });
    }
    if (code === '42501') {
      throw new AppError('FORBIDDEN', 'The email inbox is not switched on for this business.');
    }
    throw error;
  }
}
