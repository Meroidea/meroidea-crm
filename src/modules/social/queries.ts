import 'server-only';

import { and, asc, desc, eq, gt, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { contacts, socialAccounts, socialConversations, socialMessages, users } from '@/db/schema';
import { scopeFilter } from '@/lib/permissions/scope';
import { contactScope } from '@/modules/contacts/access';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { metaConfigured } from './providers/meta';
import { tiktokConfigured } from './providers/tiktok';
import type { SocialPlatform } from './providers/types';
import type { StoredAttachment } from './media';
import type { InboxFilters } from './schemas';

export const INBOX_PAGE_SIZE = 50;

/**
 * Keyset over (last_message_at desc, id desc). The time travels at the database's microsecond
 * precision, as for the audit log (ADR-063), so conversations updated together are not skipped.
 */
const cursorSchema = z.object({
  t: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  id: z.uuid(),
});

function decodeCursor(raw: string | undefined) {
  if (!raw) return null;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const sortAt = sql<string>`to_char(coalesce(${socialConversations.lastMessageAt}, ${socialConversations.createdAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * The contact a conversation is linked to, named only when the person may see that contact
 * (record scope, rules/database.md). Otherwise the link shows without a name.
 */
function contactJoin(ctx: TenantContext): SQL {
  const visible = hasPermission(ctx, 'contacts.view')
    ? (scopeFilter(ctx, 'contacts.view', contacts, contactScope) ?? sql`true`)
    : sql`false`;
  return and(
    eq(contacts.tenantId, socialConversations.tenantId),
    eq(contacts.id, socialConversations.contactId),
    isNull(contacts.deletedAt),
    visible,
  )!;
}

export type InboxRow = {
  id: string;
  participantName: string | null;
  participantUsername: string | null;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  status: string;
  platform: SocialPlatform;
  accountName: string;
  contactId: string | null;
  contactName: string | null;
  hasPicture: boolean;
};

/** The inbox: conversations across every connected account, newest message first. */
export async function listConversations(
  ctx: TenantContext,
  filters: InboxFilters,
): Promise<{ rows: InboxRow[]; nextCursor: string | null }> {
  requirePermission(ctx, 'social.view');
  const view = filters.view ?? 'open';
  const where: (SQL | undefined)[] = [eq(socialConversations.tenantId, ctx.tenantId)];
  if (view === 'open') where.push(eq(socialConversations.status, 'open'));
  if (view === 'done') where.push(eq(socialConversations.status, 'done'));
  if (view === 'unread') where.push(gt(socialConversations.unreadCount, 0));
  if (filters.platform) where.push(eq(socialAccounts.platform, filters.platform));
  const cursor = decodeCursor(filters.cursor);
  if (cursor) {
    where.push(
      sql`(coalesce(${socialConversations.lastMessageAt}, ${socialConversations.createdAt}), ${socialConversations.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`,
    );
  }

  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        id: socialConversations.id,
        participantName: socialConversations.participantName,
        participantUsername: socialConversations.participantUsername,
        lastMessageAt: socialConversations.lastMessageAt,
        lastMessagePreview: socialConversations.lastMessagePreview,
        unreadCount: socialConversations.unreadCount,
        status: socialConversations.status,
        platform: socialAccounts.platform,
        accountName: socialAccounts.name,
        contactId: socialConversations.contactId,
        contactName: contacts.fullName,
        avatarPath: socialConversations.participantAvatarPath,
        sortAt,
      })
      .from(socialConversations)
      .innerJoin(
        socialAccounts,
        and(
          eq(socialAccounts.tenantId, socialConversations.tenantId),
          eq(socialAccounts.id, socialConversations.accountId),
        ),
      )
      .leftJoin(contacts, contactJoin(ctx))
      .where(and(...where))
      .orderBy(
        desc(sql`coalesce(${socialConversations.lastMessageAt}, ${socialConversations.createdAt})`),
        desc(socialConversations.id),
      )
      .limit(INBOX_PAGE_SIZE + 1),
  );
  const page = rows.slice(0, INBOX_PAGE_SIZE);
  const last = page.at(-1);
  return {
    rows: page.map((row) => ({
      id: row.id,
      participantName: row.participantName,
      participantUsername: row.participantUsername,
      lastMessageAt: row.lastMessageAt,
      lastMessagePreview: row.lastMessagePreview,
      unreadCount: row.unreadCount,
      status: row.status,
      platform: row.platform as SocialPlatform,
      accountName: row.accountName,
      contactId: row.contactId,
      contactName: row.contactName,
      hasPicture: row.avatarPath !== null,
    })),
    nextCursor:
      rows.length > INBOX_PAGE_SIZE && last
        ? Buffer.from(JSON.stringify({ t: last.sortAt, id: last.id })).toString('base64url')
        : null,
  };
}

/** Unread conversations, for the inbox tabs. */
export async function countUnread(ctx: TenantContext): Promise<number> {
  requirePermission(ctx, 'social.view');
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(socialConversations)
      .where(
        and(eq(socialConversations.tenantId, ctx.tenantId), gt(socialConversations.unreadCount, 0)),
      ),
  );
  return row?.n ?? 0;
}

const repliers = alias(users, 'repliers');

export type ThreadMessage = {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string | null;
  attachments: StoredAttachment[];
  sentAt: Date;
  status: string;
  error: string | null;
  sentByName: string | null;
};

/** One conversation with its latest messages, oldest first, for the thread page. */
export async function getConversation(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'social.view');
  return withRls(ctx, async (tx) => {
    const [row] = await tx
      .select({
        conversation: socialConversations,
        platform: socialAccounts.platform,
        accountId: socialAccounts.id,
        accountName: socialAccounts.name,
        accountUsername: socialAccounts.username,
        accountStatus: socialAccounts.status,
        accountDisconnectedAt: socialAccounts.disconnectedAt,
        contactName: contacts.fullName,
      })
      .from(socialConversations)
      .innerJoin(
        socialAccounts,
        and(
          eq(socialAccounts.tenantId, socialConversations.tenantId),
          eq(socialAccounts.id, socialConversations.accountId),
        ),
      )
      .leftJoin(contacts, contactJoin(ctx))
      .where(and(eq(socialConversations.tenantId, ctx.tenantId), eq(socialConversations.id, id)))
      .limit(1);
    if (!row) return null;
    const latest = await tx
      .select({
        id: socialMessages.id,
        direction: socialMessages.direction,
        body: socialMessages.body,
        attachments: socialMessages.attachments,
        sentAt: socialMessages.sentAt,
        status: socialMessages.status,
        error: socialMessages.error,
        sentByName: repliers.fullName,
      })
      .from(socialMessages)
      .leftJoin(repliers, eq(repliers.id, socialMessages.sentByUserId))
      .where(and(eq(socialMessages.tenantId, ctx.tenantId), eq(socialMessages.conversationId, id)))
      .orderBy(desc(socialMessages.sentAt), desc(socialMessages.createdAt))
      .limit(200);
    return {
      ...row,
      platform: row.platform as SocialPlatform,
      messages: latest.reverse() as ThreadMessage[],
    };
  });
}

export type AccountRow = {
  id: string;
  platform: SocialPlatform;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  status: string;
  lastError: string | null;
  connectedAt: Date;
  lastSyncedAt: Date | null;
  conversations: number;
};

/** The business's connected accounts, and whether each platform is available to connect. */
export async function listAccounts(ctx: TenantContext): Promise<{
  accounts: AccountRow[];
  available: { meta: boolean; tiktok: boolean };
}> {
  if (!hasPermission(ctx, 'social.manage')) requirePermission(ctx, 'social.view');
  const accounts = await withRls(ctx, (tx) =>
    tx
      .select({
        id: socialAccounts.id,
        platform: socialAccounts.platform,
        name: socialAccounts.name,
        username: socialAccounts.username,
        avatarUrl: socialAccounts.avatarUrl,
        status: socialAccounts.status,
        lastError: socialAccounts.lastError,
        connectedAt: socialAccounts.connectedAt,
        lastSyncedAt: socialAccounts.lastSyncedAt,
        conversations: sql<number>`(select count(*)::int from ${socialConversations}
          where ${socialConversations.tenantId} = ${socialAccounts.tenantId}
            and ${socialConversations.accountId} = ${socialAccounts.id})`,
      })
      .from(socialAccounts)
      .where(and(eq(socialAccounts.tenantId, ctx.tenantId), isNull(socialAccounts.disconnectedAt)))
      .orderBy(asc(socialAccounts.platform), asc(socialAccounts.name)),
  );
  return {
    accounts: accounts.map((account) => ({
      ...account,
      platform: account.platform as SocialPlatform,
    })),
    available: { meta: metaConfigured(), tiktok: tiktokConfigured() },
  };
}

/**
 * Where one saved attachment is, for a person who may read the conversation (RLS keeps it to
 * their business). Null when there is none or it is not stored yet.
 */
export async function mediaPath(
  ctx: TenantContext,
  messageId: string,
  index: number,
): Promise<string | null> {
  requirePermission(ctx, 'social.view');
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({ attachments: socialMessages.attachments })
      .from(socialMessages)
      .where(and(eq(socialMessages.tenantId, ctx.tenantId), eq(socialMessages.id, messageId)))
      .limit(1),
  );
  const attachment = Array.isArray(row?.attachments)
    ? (row.attachments[index] as { state?: unknown; storagePath?: unknown } | undefined)
    : undefined;
  return attachment?.state === 'stored' && typeof attachment.storagePath === 'string'
    ? attachment.storagePath
    : null;
}

/** Where the customer's saved picture is, for a person who may read the conversation. */
export async function avatarPath(
  ctx: TenantContext,
  conversationId: string,
): Promise<string | null> {
  requirePermission(ctx, 'social.view');
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({ path: socialConversations.participantAvatarPath })
      .from(socialConversations)
      .where(
        and(
          eq(socialConversations.tenantId, ctx.tenantId),
          eq(socialConversations.id, conversationId),
        ),
      )
      .limit(1),
  );
  return row?.path ?? null;
}
