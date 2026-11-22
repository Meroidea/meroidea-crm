import 'server-only';

import { and, eq, gt, isNull, sql } from 'drizzle-orm';

import { socialAccounts, socialConversations, socialMessages } from '@/db/schema';
import { ticketForInboundMessage } from '@/modules/helpdesk/customer';
import { CHANNEL_NAMES, matchChannelSender } from '@/modules/leads/channel-intake';
import type { Tx } from '@/server/db/with-rls';

import {
  previewOf,
  type ProviderConversation,
  type ProviderMessage,
  type SocialPlatform,
} from './providers/types';
import { readAccountSettings } from './settings';

/*
 * Storing what providers report, the same way from a verified webhook (privileged connection)
 * and from the first import after a business connects an account (the person's own session,
 * under RLS). Every write is idempotent on the provider's ids, because webhooks are retried and
 * an import can overlap them.
 */

/**
 * How far a message's sender can be believed (ADR-070). Platform webhooks identify the customer
 * themselves; an email's From address is only trusted when it passed DKIM or DMARC.
 */
export type SenderTrust = {
  trusted: boolean;
  automated: boolean;
  /**
   * A new lead may still be made for an unverified sender who matches nobody, as a website form
   * does (live chat, ADR-072); a match is still only offered to staff, never linked.
   */
  leadWhenUnverified?: boolean;
};
const TRUSTED: SenderTrust = { trusted: true, automated: false };

/** A transaction under RLS, or the privileged client in webhooks.ts; both write the same way. */
type Db = Pick<Tx, 'insert' | 'update'>;
type AccountScope = { tenantId: string; accountId: string };

/** The conversation for this customer on this account, created on first sight. */
export async function recordConversation(
  db: Db,
  scope: AccountScope,
  conversation: Omit<ProviderConversation, 'messages'>,
): Promise<{ id: string; created: boolean }> {
  const [row] = await db
    .insert(socialConversations)
    .values({
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      externalId: conversation.externalId,
      participantId: conversation.participantId,
      participantName: conversation.participantName,
      participantUsername: conversation.participantUsername,
      participantPhone: conversation.participantPhone ?? null,
    })
    .onConflictDoUpdate({
      target: [socialConversations.accountId, socialConversations.participantId],
      set: {
        externalId: sql`coalesce(excluded.external_id, ${socialConversations.externalId})`,
        participantName: sql`coalesce(excluded.participant_name, ${socialConversations.participantName})`,
        participantUsername: sql`coalesce(excluded.participant_username, ${socialConversations.participantUsername})`,
        participantPhone: sql`coalesce(excluded.participant_phone, ${socialConversations.participantPhone})`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: socialConversations.id, created: sql<boolean>`(xmax = 0)` });
  if (!row) throw new Error('conversation not stored');
  return { id: row.id, created: row.created };
}

/**
 * Stores one message unless it is already there, and keeps the conversation's last message,
 * reply window and unread count up to date. A business message echoed back by the provider
 * first claims a reply that is still being sent from Meroidea, so it is not shown twice.
 *
 * `opensWindow: false` is for WhatsApp history: messages from before the number was connected
 * do not open WhatsApp's 24 hours for a reply. A history message whose file arrives later
 * replaces its placeholder.
 */
export async function recordMessage(
  db: Db,
  scope: AccountScope & { conversationId: string },
  message: ProviderMessage,
  options: { countUnread: boolean; opensWindow?: boolean },
): Promise<{ id: string; hasMedia: boolean } | null> {
  const opensWindow = options.opensWindow ?? true;
  let storedId: string | null = null;
  if (message.direction === 'outbound') {
    const claimed = await db
      .update(socialMessages)
      .set({ externalId: message.externalId, status: 'sent' })
      .where(
        and(
          eq(socialMessages.tenantId, scope.tenantId),
          eq(socialMessages.conversationId, scope.conversationId),
          eq(socialMessages.direction, 'outbound'),
          eq(socialMessages.status, 'sending'),
          isNull(socialMessages.externalId),
          message.body === null
            ? isNull(socialMessages.body)
            : eq(socialMessages.body, message.body),
          gt(socialMessages.createdAt, sql`now() - interval '10 minutes'`),
        ),
      )
      .returning({ id: socialMessages.id });
    storedId = claimed[0]?.id ?? null;
  }
  const attachments = message.attachments.map((attachment) =>
    attachment.url || attachment.mediaId
      ? { ...attachment, state: 'pending' }
      : attachment.placeholder
        ? { ...attachment, state: 'skipped' }
        : attachment,
  );
  const hasMedia = attachments.some(
    (attachment) => 'state' in attachment && attachment.state === 'pending',
  );
  if (!storedId && hasMedia) {
    // The file of a history message stored earlier with a placeholder.
    const filled = await db
      .update(socialMessages)
      .set({ attachments })
      .where(
        and(
          eq(socialMessages.tenantId, scope.tenantId),
          eq(socialMessages.accountId, scope.accountId),
          eq(socialMessages.externalId, message.externalId),
          sql`${socialMessages.attachments} @> '[{"placeholder": true}]'::jsonb`,
        ),
      )
      .returning({ id: socialMessages.id });
    if (filled[0]) return { id: filled[0].id, hasMedia: true };
  }
  if (!storedId) {
    const inserted = await db
      .insert(socialMessages)
      .values({
        tenantId: scope.tenantId,
        conversationId: scope.conversationId,
        accountId: scope.accountId,
        externalId: message.externalId,
        direction: message.direction,
        body: message.body,
        attachments,
        sentAt: message.sentAt,
        status: message.direction === 'inbound' ? 'received' : (message.status ?? 'sent'),
        emailMessageId: message.emailMessageId ?? null,
        emailMeta: message.emailMeta ?? null,
      })
      .onConflictDoNothing({ target: [socialMessages.accountId, socialMessages.externalId] })
      .returning({ id: socialMessages.id });
    if (!inserted[0]) return null;
    storedId = inserted[0].id;
  }

  const at = message.sentAt.toISOString();
  const inbound = message.direction === 'inbound';
  const counts = inbound && options.countUnread;
  await db
    .update(socialConversations)
    .set({
      lastMessagePreview: sql`case when ${socialConversations.lastMessageAt} is null
        or ${socialConversations.lastMessageAt} <= ${at}::timestamptz then ${previewOf(message)}
        else ${socialConversations.lastMessagePreview} end`,
      lastMessageAt: sql`greatest(coalesce(${socialConversations.lastMessageAt}, ${at}::timestamptz), ${at}::timestamptz)`,
      lastInboundAt:
        inbound && opensWindow
          ? sql`greatest(coalesce(${socialConversations.lastInboundAt}, ${at}::timestamptz), ${at}::timestamptz)`
          : sql`${socialConversations.lastInboundAt}`,
      unreadCount: counts
        ? sql`${socialConversations.unreadCount} + 1`
        : sql`${socialConversations.unreadCount}`,
      // A customer writing again reopens a conversation marked done or snoozed.
      status: counts ? 'open' : sql`${socialConversations.status}`,
      snoozedUntil: counts ? null : sql`${socialConversations.snoozedUntil}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(socialConversations.tenantId, scope.tenantId),
        eq(socialConversations.id, scope.conversationId),
      ),
    );
  return { id: storedId, hasMedia };
}

/**
 * A whole conversation from an import: the thread, then each message in order. Returns how many
 * messages were new and which of them have media still to copy into storage.
 */
export async function recordImportedConversation(
  db: Db,
  scope: AccountScope,
  conversation: ProviderConversation,
  options: { opensWindow?: boolean } = {},
): Promise<{ stored: number; withMedia: string[] }> {
  const { id } = await recordConversation(db, scope, conversation);
  let stored = 0;
  const withMedia: string[] = [];
  const ordered = [...conversation.messages].sort(
    (a, b) => a.sentAt.getTime() - b.sentAt.getTime(),
  );
  for (const message of ordered) {
    const result = await recordMessage(db, { ...scope, conversationId: id }, message, {
      countUnread: false,
      opensWindow: options.opensWindow,
    });
    if (!result) continue;
    stored += 1;
    if (result.hasMedia) withMedia.push(result.id);
  }
  return { stored, withMedia };
}

/**
 * Finds the CRM contact behind a conversation's customer (ADR-068), the first time they write
 * after it began, from a verified webhook only. Their WhatsApp number (or, later, email) is
 * looked up; one match is linked, several are left for staff. With the account's "new lead for
 * unknown senders" switched on, someone matching nobody becomes a new lead. A conversation a
 * person has linked or unlinked is never touched, and one already looked up is not looked up
 * again unless nothing was found.
 */
export async function linkConversationSender(
  tx: Tx,
  scope: AccountScope & { conversationId: string },
  sender: SenderTrust = TRUSTED,
): Promise<void> {
  const [row] = await tx
    .select({
      contactId: socialConversations.contactId,
      contactMatch: socialConversations.contactMatch,
      name: socialConversations.participantName,
      username: socialConversations.participantUsername,
      phone: socialConversations.participantPhone,
      email: socialConversations.participantEmail,
      platform: socialAccounts.platform,
      settings: socialAccounts.settings,
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
        eq(socialConversations.tenantId, scope.tenantId),
        eq(socialConversations.id, scope.conversationId),
      ),
    )
    .limit(1);
  if (!row || row.contactId || row.contactMatch !== null) return;
  const settings = readAccountSettings(row.settings);
  const match = await matchChannelSender(
    tx,
    {
      tenantId: scope.tenantId,
      channel: row.platform as SocialPlatform,
      conversationId: scope.conversationId,
      name: row.name ?? row.username,
      email: row.email,
      // WhatsApp keeps the number as digits in international form.
      phone: row.phone ? `+${row.phone}` : null,
    },
    {
      ...settings,
      // An email's sender address can be forged: only one that passed DKIM or DMARC is linked
      // or made a lead; otherwise the match is only offered to staff (ADR-070). A machine's
      // message (an auto-reply, a bounce) never makes a lead.
      createLeadForUnknown:
        settings.createLeadForUnknown &&
        (sender.trusted || sender.leadWhenUnverified === true) &&
        !sender.automated,
      trusted: sender.trusted,
    },
  );
  if (match.kind === 'none') return;
  await tx
    .update(socialConversations)
    .set({ contactId: match.contactId, contactMatch: match.kind, updatedAt: new Date() })
    .where(
      and(
        eq(socialConversations.tenantId, scope.tenantId),
        eq(socialConversations.id, scope.conversationId),
        isNull(socialConversations.contactId),
        isNull(socialConversations.contactMatch),
      ),
    );
}

/**
 * Everything a customer's new message sets off (verified webhooks only): finding their contact
 * (ADR-068), then the helpdesk ticket that follows the conversation, reopened or, when the
 * account is set to, opened (ADR-069).
 */
export async function afterInboundMessage(
  tx: Tx,
  scope: AccountScope & { conversationId: string },
  sender: SenderTrust = TRUSTED,
): Promise<void> {
  // In a savepoint: the customer's message is already stored in this transaction, and a problem
  // here must never undo it (the provider would retry, and in time give up on the message).
  try {
    await tx.transaction((savepoint) => followUpInbound(savepoint, scope, sender));
  } catch (error) {
    console.error('[social] could not follow up a message', {
      name: error instanceof Error ? error.name : typeof error,
    });
  }
}

async function followUpInbound(
  tx: Tx,
  scope: AccountScope & { conversationId: string },
  sender: SenderTrust,
): Promise<void> {
  await linkConversationSender(tx, scope, sender);
  const [row] = await tx
    .select({
      contactId: socialConversations.contactId,
      name: socialConversations.participantName,
      username: socialConversations.participantUsername,
      phone: socialConversations.participantPhone,
      email: socialConversations.participantEmail,
      platform: socialAccounts.platform,
      settings: socialAccounts.settings,
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
        eq(socialConversations.tenantId, scope.tenantId),
        eq(socialConversations.id, scope.conversationId),
      ),
    )
    .limit(1);
  if (!row) return;
  const settings = readAccountSettings(row.settings);
  const channelName = CHANNEL_NAMES[row.platform as SocialPlatform];
  await ticketForInboundMessage(tx, {
    tenantId: scope.tenantId,
    conversationId: scope.conversationId,
    contactId: row.contactId,
    customerName:
      row.name ??
      (row.username
        ? `@${row.username}`
        : row.phone
          ? `+${row.phone}`
          : (row.email ?? `${channelName} customer`)),
    customerEmail: row.email,
    channelName,
    // An auto-reply or bounce never opens a ticket (it still reopens one it answers).
    autoTicket: settings.autoTicket && !sender.automated,
    priority: settings.autoTicketPriority,
  });
}
