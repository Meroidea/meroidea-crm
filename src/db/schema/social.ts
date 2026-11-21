import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { contacts } from './crm';
import { tenants } from './tenancy';

/**
 * A social media account a business has connected: a Facebook Page, an Instagram professional
 * account, a TikTok business account (ADR-064) or a WhatsApp business phone number (ADR-066).
 * One live connection per account across the platform, so an incoming message has exactly one
 * business to go to.
 */
export const socialAccounts = pgTable(
  'social_accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** facebook | instagram | tiktok | whatsapp */
    platform: text().notNull(),
    /**
     * The provider's id: Page id, Instagram account id, TikTok business id (open_id), or the
     * WhatsApp business phone number's id.
     */
    externalId: text().notNull(),
    name: text().notNull(),
    username: text(),
    avatarUrl: text(),
    /**
     * Meta: the client's business portfolio, so its app removal can be matched. WhatsApp: the
     * WhatsApp Business Account (Messaging account) the number belongs to.
     */
    providerBusinessId: text(),
    /**
     * WhatsApp: the number is also used in the WhatsApp Business app on the business's phone
     * ("coexistence"), so messages sent from the phone arrive here too.
     */
    coexistence: boolean().notNull().default(false),
    /**
     * WhatsApp Business app numbers: importing the app's chat history (up to 180 days), which
     * must be asked for within 24 hours of connecting. requested | in_progress | complete |
     * declined | failed; empty when there is nothing to import.
     */
    historySync: text(),
    /** How far the history import has come, 0 to 100, as WhatsApp reports it. */
    historyProgress: integer(),
    /** active | needs_reconnect | disconnected */
    status: text().notNull().default('active'),
    /** What went wrong last, in words for the business; never a token or a payload. */
    lastError: text(),
    connectedBy: uuid(),
    connectedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    disconnectedAt: timestamp({ withTimezone: true }),
    lastSyncedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('social_accounts_tenant_id_id_key').on(table.tenantId, table.id),
    uniqueIndex('social_accounts_live_key')
      .on(table.platform, table.externalId)
      .where(sql`${table.disconnectedAt} is null`),
    index('social_accounts_tenant_idx').on(table.tenantId, table.status),
    check(
      'social_accounts_platform_check',
      sql`${table.platform} in ('facebook', 'instagram', 'tiktok', 'whatsapp')`,
    ),
    check(
      'social_accounts_history_sync_check',
      sql`${table.historySync} in ('requested', 'in_progress', 'complete', 'declined', 'failed')`,
    ),
    check(
      'social_accounts_history_progress_check',
      sql`${table.historyProgress} between 0 and 100`,
    ),
    check(
      'social_accounts_status_check',
      sql`${table.status} in ('active', 'needs_reconnect', 'disconnected')`,
    ),
  ],
);

/**
 * The account's access tokens, sealed with encryptField (src/server/crypto.ts). No session may
 * read this table: only the app.social_* functions (with a permission check) and verified
 * webhooks.
 */
export const socialAccountCredentials = pgTable(
  'social_account_credentials',
  {
    accountId: uuid().primaryKey(),
    tenantId: uuid().notNull(),
    accessTokenCiphertext: text().notNull(),
    accessExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenCiphertext: text(),
    refreshExpiresAt: timestamp({ withTimezone: true }),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'social_account_credentials_account_fkey',
      columns: [table.tenantId, table.accountId],
      foreignColumns: [socialAccounts.tenantId, socialAccounts.id],
    }).onDelete('cascade'),
  ],
);

/** One customer's thread with one connected account. */
export const socialConversations = pgTable(
  'social_conversations',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    accountId: uuid().notNull(),
    /** The provider's conversation id, where it has one (needed to reply on TikTok). */
    externalId: text(),
    /**
     * The customer's id as the provider scopes it to this account (PSID, IGSID, TikTok id; on
     * WhatsApp their number, or their business-scoped user id when they hide it).
     */
    participantId: text().notNull(),
    participantName: text(),
    participantUsername: text(),
    /** WhatsApp: the customer's phone number in international form, digits only. */
    participantPhone: text(),
    /** The customer's picture, saved to the private `social-media` bucket (provider links expire). */
    participantAvatarPath: text(),
    /** The CRM contact this customer is, once someone links them. */
    contactId: uuid(),
    lastMessageAt: timestamp({ withTimezone: true }),
    lastMessagePreview: text(),
    /** The customer's last message: the provider's reply window counts from here. */
    lastInboundAt: timestamp({ withTimezone: true }),
    unreadCount: integer().notNull().default(0),
    /** open | done */
    status: text().notNull().default('open'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('social_conversations_tenant_id_id_key').on(table.tenantId, table.id),
    unique('social_conversations_participant_key').on(table.accountId, table.participantId),
    foreignKey({
      name: 'social_conversations_account_fkey',
      columns: [table.tenantId, table.accountId],
      foreignColumns: [socialAccounts.tenantId, socialAccounts.id],
    }),
    foreignKey({
      name: 'social_conversations_contact_fkey',
      columns: [table.tenantId, table.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }),
    index('social_conversations_inbox_idx').on(table.tenantId, table.lastMessageAt, table.id),
    check('social_conversations_status_check', sql`${table.status} in ('open', 'done')`),
  ],
);

/** A message in a conversation, from the customer (inbound) or the business (outbound). */
export const socialMessages = pgTable(
  'social_messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    conversationId: uuid().notNull(),
    accountId: uuid().notNull(),
    /** The provider's message id; empty only while a reply is being sent or after it failed. */
    externalId: text(),
    /** inbound | outbound */
    direction: text().notNull(),
    body: text(),
    /**
     * [{ type, state: pending | stored | failed | skipped, storagePath?, mimeType?, size?,
     *    url?, mediaId? }]. Media is copied into the private `social-media` bucket, because
     * provider links expire; `url`/`mediaId` are kept only until it is stored (ADR-065).
     */
    attachments: jsonb().notNull().default([]),
    sentAt: timestamp({ withTimezone: true }).notNull(),
    /**
     * WhatsApp: the approved template this message was sent with, `{ name, language,
     * parameters }`, so a failed one is sent again as the same template.
     */
    template: jsonb(),
    /** Who replied from Meroidea; empty for the customer and for replies made in the app itself. */
    sentByUserId: uuid(),
    /** received (inbound) | sending | sent | delivered | read | failed (outbound) */
    status: text().notNull().default('received'),
    error: text(),
    /** When the customer's app received and read a reply, from the provider's receipts. */
    deliveredAt: timestamp({ withTimezone: true }),
    readAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('social_messages_tenant_id_id_key').on(table.tenantId, table.id),
    uniqueIndex('social_messages_external_key').on(table.accountId, table.externalId),
    foreignKey({
      name: 'social_messages_conversation_fkey',
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [socialConversations.tenantId, socialConversations.id],
    }),
    foreignKey({
      name: 'social_messages_account_fkey',
      columns: [table.tenantId, table.accountId],
      foreignColumns: [socialAccounts.tenantId, socialAccounts.id],
    }),
    index('social_messages_thread_idx').on(table.tenantId, table.conversationId, table.sentAt),
    check('social_messages_direction_check', sql`${table.direction} in ('inbound', 'outbound')`),
    check(
      'social_messages_status_check',
      sql`${table.status} in ('received', 'sending', 'sent', 'delivered', 'read', 'failed')`,
    ),
  ],
);

/**
 * A WhatsApp message template of a connected number's WhatsApp Business Account (ADR-066). Meta
 * reviews each one; outside the 24 hours after a customer's last message, only an approved
 * template may be sent. Kept here so the reply box does not ask Meta each time (Meta allows 200
 * template reads an hour); changes arrive by webhook and with "Refresh".
 */
export const socialMessageTemplates = pgTable(
  'social_message_templates',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    accountId: uuid().notNull(),
    /** Meta's template id. */
    externalId: text().notNull(),
    name: text().notNull(),
    /** Meta's language code, e.g. en, en_US. */
    language: text().notNull(),
    /** marketing | utility | authentication, as Meta classified it. */
    category: text().notNull(),
    /** Meta's review status, lower case: approved, pending, rejected, paused, disabled, … */
    status: text().notNull(),
    /** positional ({{1}}) | named ({{first_name}}) */
    parameterFormat: text().notNull().default('positional'),
    body: text().notNull(),
    headerText: text(),
    footerText: text(),
    /** The body's placeholders in order: "1", "2", … or the names. */
    parameters: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /**
     * Whether Meroidea can send it: a text body, with at most a text header and a footer and
     * buttons that need no values. Others are listed but sent from WhatsApp Manager.
     */
    sendable: boolean().notNull().default(true),
    /** Why Meta rejected or paused it, in Meta's words. */
    reason: text(),
    createdBy: uuid(),
    syncedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('social_message_templates_tenant_id_id_key').on(table.tenantId, table.id),
    unique('social_message_templates_external_key').on(table.accountId, table.externalId),
    foreignKey({
      name: 'social_message_templates_account_fkey',
      columns: [table.tenantId, table.accountId],
      foreignColumns: [socialAccounts.tenantId, socialAccounts.id],
    }),
    index('social_message_templates_account_idx').on(table.tenantId, table.accountId, table.name),
    check(
      'social_message_templates_format_check',
      sql`${table.parameterFormat} in ('positional', 'named')`,
    ),
  ],
);
