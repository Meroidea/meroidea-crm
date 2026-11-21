import 'server-only';

import { and, asc, desc, eq, gt, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import {
  contacts,
  socialAccounts,
  socialConversations,
  socialMessages,
  socialMessageTemplates,
  users,
} from '@/db/schema';
import { scopeFilter } from '@/lib/permissions/scope';
import { contactScope } from '@/modules/contacts/access';
import { listActiveMembers, listMemberIdsWithPermission } from '@/modules/members/queries';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { metaConfigured } from './providers/meta';
import { tiktokConfigured } from './providers/tiktok';
import { whatsappConfigured } from './providers/whatsapp';
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
  participantPhone: string | null;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  status: string;
  platform: SocialPlatform;
  accountName: string;
  contactId: string | null;
  contactName: string | null;
  hasPicture: boolean;
  snoozedUntil: Date | null;
  /** Set aside right now (its snooze time has not come). */
  snoozedNow: boolean;
  assignedUserId: string | null;
  assigneeName: string | null;
};

const snoozedNow = sql<boolean>`(${socialConversations.status} = 'snoozed' and ${socialConversations.snoozedUntil} > now())`;

const assignees = alias(users, 'assignees');

/** A snoozed conversation whose time has come counts as open again (ADR-067). */
const awake = sql`(${socialConversations.status} = 'open' or (${socialConversations.status} = 'snoozed' and ${socialConversations.snoozedUntil} <= now()))`;

/** `%` and `_` typed into the search box are searched for, not wildcards. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

/** The inbox: conversations across every connected account, newest message first. */
export async function listConversations(
  ctx: TenantContext,
  filters: InboxFilters,
): Promise<{ rows: InboxRow[]; nextCursor: string | null }> {
  requirePermission(ctx, 'social.view');
  const view = filters.view ?? 'open';
  const where: (SQL | undefined)[] = [eq(socialConversations.tenantId, ctx.tenantId)];
  if (view === 'open') where.push(awake);
  if (view === 'mine') where.push(awake, eq(socialConversations.assignedUserId, ctx.userId));
  if (view === 'snoozed') {
    where.push(
      eq(socialConversations.status, 'snoozed'),
      sql`${socialConversations.snoozedUntil} > now()`,
    );
  }
  if (view === 'done') where.push(eq(socialConversations.status, 'done'));
  if (view === 'unread') where.push(gt(socialConversations.unreadCount, 0));
  if (filters.q) {
    // The same expression as the trigram index (0075), or a message in the thread.
    const pattern = likePattern(filters.q);
    where.push(sql`((coalesce(${socialConversations.participantName}, '') || ' ' || coalesce(${socialConversations.participantUsername}, '') || ' ' || coalesce(${socialConversations.participantPhone}, '')) ilike ${pattern}
      or exists (select 1 from ${socialMessages} m where m.tenant_id = ${socialConversations.tenantId}
        and m.conversation_id = ${socialConversations.id} and m.body ilike ${pattern}))`);
  }
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
        participantPhone: socialConversations.participantPhone,
        lastMessageAt: socialConversations.lastMessageAt,
        lastMessagePreview: socialConversations.lastMessagePreview,
        unreadCount: socialConversations.unreadCount,
        status: socialConversations.status,
        platform: socialAccounts.platform,
        accountName: socialAccounts.name,
        contactId: socialConversations.contactId,
        contactName: contacts.fullName,
        avatarPath: socialConversations.participantAvatarPath,
        snoozedUntil: socialConversations.snoozedUntil,
        snoozedNow,
        assignedUserId: socialConversations.assignedUserId,
        assigneeName: assignees.fullName,
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
      .leftJoin(assignees, eq(assignees.id, socialConversations.assignedUserId))
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
      participantPhone: row.participantPhone,
      lastMessageAt: row.lastMessageAt,
      lastMessagePreview: row.lastMessagePreview,
      unreadCount: row.unreadCount,
      status: row.status,
      platform: row.platform as SocialPlatform,
      accountName: row.accountName,
      contactId: row.contactId,
      contactName: row.contactName,
      hasPicture: row.avatarPath !== null,
      snoozedUntil: row.snoozedUntil,
      snoozedNow: row.snoozedNow,
      assignedUserId: row.assignedUserId,
      assigneeName: row.assigneeName,
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
        contactEmail: contacts.email,
        contactPhone: contacts.phone,
        assigneeName: assignees.fullName,
        snoozedNow,
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
      .leftJoin(assignees, eq(assignees.id, socialConversations.assignedUserId))
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
  coexistence: boolean;
  historySync: string | null;
  historyProgress: number | null;
};

/** The business's connected accounts, and whether each platform is available to connect. */
export async function listAccounts(ctx: TenantContext): Promise<{
  accounts: AccountRow[];
  available: { meta: boolean; tiktok: boolean; whatsapp: boolean };
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
        coexistence: socialAccounts.coexistence,
        historySync: socialAccounts.historySync,
        historyProgress: socialAccounts.historyProgress,
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
    available: {
      meta: metaConfigured(),
      tiktok: tiktokConfigured(),
      whatsapp: whatsappConfigured(),
    },
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

export type TemplateRow = {
  id: string;
  accountId: string;
  name: string;
  language: string;
  category: string;
  status: string;
  body: string;
  headerText: string | null;
  footerText: string | null;
  parameters: string[];
  sendable: boolean;
  reason: string | null;
  syncedAt: Date;
};

const templateColumns = {
  id: socialMessageTemplates.id,
  accountId: socialMessageTemplates.accountId,
  name: socialMessageTemplates.name,
  language: socialMessageTemplates.language,
  category: socialMessageTemplates.category,
  status: socialMessageTemplates.status,
  body: socialMessageTemplates.body,
  headerText: socialMessageTemplates.headerText,
  footerText: socialMessageTemplates.footerText,
  parameters: socialMessageTemplates.parameters,
  sendable: socialMessageTemplates.sendable,
  reason: socialMessageTemplates.reason,
  syncedAt: socialMessageTemplates.syncedAt,
};

/** Every WhatsApp template of the business's live numbers, for the templates page. */
export async function listTemplates(ctx: TenantContext): Promise<TemplateRow[]> {
  requirePermission(ctx, 'social.manage');
  return withRls(ctx, (tx) =>
    tx
      .select(templateColumns)
      .from(socialMessageTemplates)
      .innerJoin(
        socialAccounts,
        and(
          eq(socialAccounts.tenantId, socialMessageTemplates.tenantId),
          eq(socialAccounts.id, socialMessageTemplates.accountId),
        ),
      )
      .where(
        and(
          eq(socialMessageTemplates.tenantId, ctx.tenantId),
          isNull(socialAccounts.disconnectedAt),
        ),
      )
      .orderBy(asc(socialMessageTemplates.name), asc(socialMessageTemplates.language))
      .limit(1000),
  );
}

/** The approved templates a person may send in a conversation with this WhatsApp number. */
export async function sendableTemplates(
  ctx: TenantContext,
  accountId: string,
): Promise<TemplateRow[]> {
  if (!hasPermission(ctx, 'social.reply')) return [];
  return withRls(ctx, (tx) =>
    tx
      .select(templateColumns)
      .from(socialMessageTemplates)
      .where(
        and(
          eq(socialMessageTemplates.tenantId, ctx.tenantId),
          eq(socialMessageTemplates.accountId, accountId),
          eq(socialMessageTemplates.status, 'approved'),
          eq(socialMessageTemplates.sendable, true),
        ),
      )
      .orderBy(asc(socialMessageTemplates.name), asc(socialMessageTemplates.language))
      .limit(500),
  );
}

/** Colleagues a conversation can be given to: active members who can read the inbox. */
export async function assignableMembers(
  ctx: TenantContext,
): Promise<{ userId: string; fullName: string }[]> {
  requirePermission(ctx, 'social.view');
  const [members, allowed] = await Promise.all([
    listActiveMembers(ctx),
    listMemberIdsWithPermission(ctx, 'social.view'),
  ]);
  return members
    .filter((member) => allowed.includes(member.userId))
    .map((member) => ({ userId: member.userId, fullName: member.fullName ?? 'Colleague' }));
}
