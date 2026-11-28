import 'server-only';

import { and, asc, desc, eq, gt, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import {
  contacts,
  emailSenderRules,
  socialAccounts,
  socialCannedResponses,
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
import { emailInboxConfigured } from './providers/resend';
import { tiktokConfigured } from './providers/tiktok';
import { whatsappConfigured } from './providers/whatsapp';
import type { Mailbox, SocialPlatform } from './providers/types';
import type { StoredAttachment } from './media';
import type { TimelineItem } from '@/modules/activities/types';

import { PLATFORM_LABELS } from './format';
import { readStoredCompose, type StoredCompose } from './email-doc';
import type { EmailFolder, InboxFilters } from './schemas';
import { readAccountSettings, type AccountSettings } from './settings';

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
  /** Email (ADR-070): the customer's address and the thread's subject. */
  participantEmail: string | null;
  subject: string | null;
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

/*
 * The Email area's folders (ADR-073), written out in full because they are correlated subqueries.
 * A thread is "automated" when no customer-written message is in it: every inbound message was an
 * auto-reply, a bounce or list mail (`email_meta.automated`, ADR-070).
 */
const automatedOnly = sql`not exists (select 1 from public.social_messages m
  where m.tenant_id = social_conversations.tenant_id and m.conversation_id = social_conversations.id
    and m.direction = 'inbound' and coalesce((m.email_meta ->> 'automated')::boolean, false) = false)`;
const markedNotCustomer = sql`exists (select 1 from public.email_sender_rules r
  where r.tenant_id = social_conversations.tenant_id
    and r.email = social_conversations.participant_email and r.kind = 'not_customer')`;

/** Nothing has come in yet: a thread the business started (ADR-089). */
const nothingReceived = sql`not exists (select 1 from public.social_messages m
  where m.tenant_id = social_conversations.tenant_id and m.conversation_id = social_conversations.id
    and m.direction = 'inbound')`;

/**
 * Which email threads a folder holds. Customers: linked to a contact. To review: not linked yet.
 * Filtered: machines' mail, and senders marked "Not a customer" who are not linked to a contact.
 * Sent: started by the business and not answered yet; the first reply moves it to one of the
 * others. Every thread is in exactly one folder, so nothing received is ever out of sight for
 * good. (A thread with nothing received counts as `automatedOnly`, so Customers and To review
 * already leave it out.)
 */
export function emailFolderCondition(folder: EmailFolder): SQL {
  const linked = sql`social_conversations.contact_id is not null`;
  if (folder === 'sent') return nothingReceived;
  if (folder === 'customers') return sql`(${linked} and not ${automatedOnly})`;
  if (folder === 'review') {
    return sql`(not ${linked} and not ${automatedOnly} and not ${markedNotCustomer})`;
  }
  return sql`(not ${nothingReceived} and (${automatedOnly} or (not ${linked} and ${markedNotCustomer})))`;
}

/** Only the channels of one area: the Social inbox, or Email (ADR-073). */
function mailboxCondition(mailbox: Mailbox): SQL {
  return mailbox === 'email'
    ? eq(socialAccounts.platform, 'email')
    : sql`${socialAccounts.platform} <> 'email'`;
}

/**
 * Conversations in one area across its connected accounts, newest message first: the Social
 * inbox (social media and website chat) or Email, one folder at a time.
 */
export async function listConversations(
  ctx: TenantContext,
  filters: InboxFilters,
  mailbox: Mailbox = 'social',
): Promise<{ rows: InboxRow[]; nextCursor: string | null }> {
  requirePermission(ctx, 'social.view');
  const view = filters.view ?? 'open';
  const where: (SQL | undefined)[] = [
    eq(socialConversations.tenantId, ctx.tenantId),
    mailboxCondition(mailbox),
  ];
  if (mailbox === 'email') where.push(emailFolderCondition(filters.folder ?? 'customers'));
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
      or coalesce(${socialConversations.participantEmail}, '') ilike ${pattern}
      or coalesce(${socialConversations.subject}, '') ilike ${pattern}
      or exists (select 1 from ${socialMessages} m where m.tenant_id = ${socialConversations.tenantId}
        and m.conversation_id = ${socialConversations.id} and m.body ilike ${pattern}))`);
  }
  if (filters.platform && mailbox === 'social' && filters.platform !== 'email') {
    where.push(eq(socialAccounts.platform, filters.platform));
  }
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
        participantEmail: socialConversations.participantEmail,
        subject: socialConversations.subject,
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
      participantEmail: row.participantEmail,
      subject: row.subject,
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

/**
 * Unread conversations per channel in the Social inbox, for its tabs and channel filter
 * (ADR-073): `total` and one count per connected channel.
 */
export async function countUnread(
  ctx: TenantContext,
): Promise<{ total: number; byPlatform: Partial<Record<SocialPlatform, number>> }> {
  requirePermission(ctx, 'social.view');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({ platform: socialAccounts.platform, n: sql<number>`count(*)::int` })
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
          mailboxCondition('social'),
          gt(socialConversations.unreadCount, 0),
        ),
      )
      .groupBy(socialAccounts.platform),
  );
  const byPlatform: Partial<Record<SocialPlatform, number>> = {};
  for (const row of rows) byPlatform[row.platform as SocialPlatform] = row.n;
  return { total: rows.reduce((sum, row) => sum + row.n, 0), byPlatform };
}

/** Unread email threads per folder, for the Email area's tabs (ADR-073, ADR-089). */
export async function countEmailUnread(ctx: TenantContext): Promise<Record<EmailFolder, number>> {
  requirePermission(ctx, 'social.view');
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({
        customers: sql<number>`(count(*) filter (where ${emailFolderCondition('customers')}))::int`,
        review: sql<number>`(count(*) filter (where ${emailFolderCondition('review')}))::int`,
        filtered: sql<number>`(count(*) filter (where ${emailFolderCondition('filtered')}))::int`,
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
          mailboxCondition('email'),
          gt(socialConversations.unreadCount, 0),
        ),
      ),
  );
  return {
    customers: row?.customers ?? 0,
    review: row?.review ?? 0,
    filtered: row?.filtered ?? 0,
    // Nothing unread can be in Sent: unread messages are received ones, which move a thread out.
    sent: 0,
  };
}

/** Whether an email thread's sender is marked "Not a customer", for the thread's controls. */
export async function senderMarkedNotCustomer(
  ctx: TenantContext,
  email: string | null,
): Promise<boolean> {
  if (!email) return false;
  requirePermission(ctx, 'social.view');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({ id: emailSenderRules.id })
      .from(emailSenderRules)
      .where(and(eq(emailSenderRules.tenantId, ctx.tenantId), eq(emailSenderRules.email, email)))
      .limit(1),
  );
  return rows.length > 0;
}

const repliers = alias(users, 'repliers');

export type ThreadMessage = {
  id: string;
  /** `note`: a private note between colleagues (ADR-068). */
  direction: 'inbound' | 'outbound' | 'note';
  body: string | null;
  attachments: StoredAttachment[];
  sentAt: Date;
  status: string;
  error: string | null;
  sentByName: string | null;
  /** Email: whether the sender passed DKIM or DMARC, and whether a machine sent it. */
  emailMeta: { verified?: boolean; automated?: boolean; to?: string[]; cc?: string[] } | null;
  /** Email written in Compose (ADR-090): recipients and formatting, checked again here. */
  composed: StoredCompose | null;
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
        emailMeta: socialMessages.emailMeta,
        emailOutbound: socialMessages.emailOutbound,
      })
      .from(socialMessages)
      .leftJoin(repliers, eq(repliers.id, socialMessages.sentByUserId))
      .where(and(eq(socialMessages.tenantId, ctx.tenantId), eq(socialMessages.conversationId, id)))
      .orderBy(desc(socialMessages.sentAt), desc(socialMessages.createdAt))
      .limit(200);
    // Several contacts share the customer's number: offer them, rather than guessing (ADR-068).
    const { participantPhone, participantEmail } = row.conversation;
    const suggestions =
      row.conversation.contactMatch === 'suggested' &&
      (participantPhone || participantEmail) &&
      hasPermission(ctx, 'contacts.view')
        ? await tx
            .select({ id: contacts.id, name: contacts.fullName })
            .from(contacts)
            .where(
              and(
                eq(contacts.tenantId, ctx.tenantId),
                participantPhone
                  ? eq(contacts.phoneE164, `+${participantPhone}`)
                  : eq(contacts.emailNormalized, participantEmail!),
                isNull(contacts.deletedAt),
                scopeFilter(ctx, 'contacts.view', contacts, contactScope),
              ),
            )
            .orderBy(asc(contacts.createdAt))
            .limit(5)
        : [];
    return {
      ...row,
      platform: row.platform as SocialPlatform,
      messages: latest.reverse().map(({ emailOutbound, ...message }) => ({
        ...message,
        composed: message.direction === 'outbound' ? readStoredCompose(emailOutbound) : null,
      })) as ThreadMessage[],
      suggestions: suggestions.map((item) => ({ id: item.id, name: item.name ?? '' })),
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
  settings: AccountSettings;
  /** Live chat: the widget's public key. */
  widgetKey: string | null;
};

/** The business's connected accounts, and whether each platform is available to connect. */
export async function listAccounts(ctx: TenantContext): Promise<{
  accounts: AccountRow[];
  available: { meta: boolean; tiktok: boolean; whatsapp: boolean; email: boolean };
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
        settings: socialAccounts.settings,
        // A live chat widget's public key, for its embed code; other accounts' ids stay out.
        widgetKey: sql<
          string | null
        >`case when social_accounts.platform = 'livechat' then social_accounts.external_id end`,
        // Written out in full: in a one-table select Drizzle leaves columns unqualified, which
        // inside a subquery would bind to the inner table and always count nothing.
        conversations: sql<number>`(select count(*)::int from public.social_conversations c
          where c.tenant_id = social_accounts.tenant_id and c.account_id = social_accounts.id)`,
      })
      .from(socialAccounts)
      .where(and(eq(socialAccounts.tenantId, ctx.tenantId), isNull(socialAccounts.disconnectedAt)))
      .orderBy(asc(socialAccounts.platform), asc(socialAccounts.name)),
  );
  return {
    accounts: accounts.map((account) => ({
      ...account,
      platform: account.platform as SocialPlatform,
      settings: readAccountSettings(account.settings),
    })),
    available: {
      meta: metaConfigured(),
      tiktok: tiktokConfigured(),
      whatsapp: whatsappConfigured(),
      email: emailInboxConfigured(),
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

export type CannedResponseRow = {
  id: string;
  title: string;
  shortcut: string | null;
  body: string;
  /** Shared with the whole team, rather than the person's own. */
  shared: boolean;
};

/** The saved replies a person can use: the team's shared ones and their own (ADR-068). */
export async function listCannedResponses(ctx: TenantContext): Promise<CannedResponseRow[]> {
  if (!hasPermission(ctx, 'social.reply')) return [];
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        id: socialCannedResponses.id,
        title: socialCannedResponses.title,
        shortcut: socialCannedResponses.shortcut,
        body: socialCannedResponses.body,
        ownerUserId: socialCannedResponses.ownerUserId,
      })
      .from(socialCannedResponses)
      .where(eq(socialCannedResponses.tenantId, ctx.tenantId))
      .orderBy(asc(socialCannedResponses.title))
      // A team keeps tens of these, not thousands; the cap keeps the page bounded.
      .limit(500),
  );
  return rows.map(({ ownerUserId, ...row }) => ({ ...row, shared: ownerUserId === null }));
}

/**
 * The contact's inbox conversations for their timeline (ADR-068): which channel, how many
 * messages and when the last one was, linking to the thread. Never what was said: the thread
 * keeps that, behind social.view. Empty for someone without social.view.
 */
export async function conversationsForContact(
  ctx: TenantContext,
  contactId: string,
): Promise<TimelineItem[]> {
  if (!hasPermission(ctx, 'social.view')) return [];
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        id: socialConversations.id,
        platform: socialAccounts.platform,
        accountName: socialAccounts.name,
        at: sql<Date>`coalesce(${socialConversations.lastMessageAt}, ${socialConversations.createdAt})`.mapWith(
          (value: string | Date) => new Date(value),
        ),
        messages: sql<number>`(select count(*)::int from ${socialMessages}
          where ${socialMessages.tenantId} = ${socialConversations.tenantId}
            and ${socialMessages.conversationId} = ${socialConversations.id}
            and ${socialMessages.direction} <> 'note')`,
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
          eq(socialConversations.contactId, contactId),
        ),
      )
      .orderBy(desc(socialConversations.lastMessageAt))
      .limit(20),
  );
  return rows.map((row) => ({
    id: `conversation-${row.id}`,
    type: 'conversation',
    subject: `${PLATFORM_LABELS[row.platform as SocialPlatform]} conversation with ${row.accountName} · ${row.messages} ${row.messages === 1 ? 'message' : 'messages'}`,
    body: null,
    outcome: null,
    direction: null,
    occurredAt: row.at,
    actorName: null,
    contactId,
    contactName: null,
    opportunityId: null,
    opportunityName: null,
    href: `/social/${row.id}`,
  }));
}

/**
 * What a ticket made from a conversation needs to know about it (ADR-069): who the customer is
 * and on which channel. Null when the person cannot read the inbox or it is not their business's.
 */
export async function getConversationForTicket(
  ctx: TenantContext,
  id: string,
): Promise<{
  id: string;
  contactId: string | null;
  customerName: string;
  /** Email conversations: the customer's address (ADR-070). */
  customerEmail: string | null;
  platform: SocialPlatform;
  accountName: string;
} | null> {
  if (!hasPermission(ctx, 'social.view')) return null;
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({
        id: socialConversations.id,
        contactId: socialConversations.contactId,
        participantName: socialConversations.participantName,
        participantUsername: socialConversations.participantUsername,
        participantPhone: socialConversations.participantPhone,
        participantEmail: socialConversations.participantEmail,
        platform: socialAccounts.platform,
        accountName: socialAccounts.name,
      })
      .from(socialConversations)
      .innerJoin(
        socialAccounts,
        and(
          eq(socialAccounts.tenantId, socialConversations.tenantId),
          eq(socialAccounts.id, socialConversations.accountId),
        ),
      )
      .where(and(eq(socialConversations.tenantId, ctx.tenantId), eq(socialConversations.id, id)))
      .limit(1),
  );
  if (!row) return null;
  const platform = row.platform as SocialPlatform;
  return {
    id: row.id,
    contactId: row.contactId,
    customerName:
      row.participantName ??
      (row.participantUsername
        ? `@${row.participantUsername}`
        : row.participantPhone
          ? `+${row.participantPhone}`
          : (row.participantEmail ?? `${PLATFORM_LABELS[platform]} customer`)),
    customerEmail: row.participantEmail,
    platform,
    accountName: row.accountName,
  };
}
