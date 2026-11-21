import 'server-only';

import { and, eq, gt, isNull, sql } from 'drizzle-orm';

import { socialConversations, socialMessages } from '@/db/schema';
import type { Tx } from '@/server/db/with-rls';

import { previewOf, type ProviderConversation, type ProviderMessage } from './providers/types';

/*
 * Storing what providers report, the same way from a verified webhook (privileged connection)
 * and from the first import after a business connects an account (the person's own session,
 * under RLS). Every write is idempotent on the provider's ids, because webhooks are retried and
 * an import can overlap them.
 */

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
      // A customer writing again reopens a conversation marked done.
      status: counts ? 'open' : sql`${socialConversations.status}`,
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
