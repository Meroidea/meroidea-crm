import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { contacts } from './crm';
import { tickets } from './helpdesk';
import { socialConversations } from './social';
import { tenants } from './tenancy';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/**
 * A business's public help portal (ADR-071), at /help/<business slug>. Closed until the business
 * switches it on; articles are read there only while published.
 */
export const kbPortals = pgTable('kb_portals', {
  tenantId: uuid()
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'restrict' }),
  isPublic: boolean().notNull().default(false),
  title: text(),
  intro: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid(),
});

/** A heading articles are grouped under on the portal. */
export const kbCategories = pgTable(
  'kb_categories',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    slug: text().notNull(),
    description: text(),
    position: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    unique('kb_categories_tenant_id_id_key').on(table.tenantId, table.id),
    uniqueIndex('kb_categories_slug_key')
      .on(table.tenantId, table.slug)
      .where(sql`${table.deletedAt} is null`),
    check('kb_categories_slug_check', sql`${table.slug} ~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$'`),
  ],
);

/**
 * A help article, written in Markdown (rendered without raw HTML). Searchable by its title,
 * summary and words; read on the portal only while published.
 */
export const kbArticles = pgTable(
  'kb_articles',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    categoryId: uuid(),
    title: text().notNull(),
    slug: text().notNull(),
    /** One or two sentences: the portal's list and the page's search-engine description. */
    summary: text(),
    bodyMarkdown: text().notNull().default(''),
    /** draft | published */
    status: text().notNull().default('draft'),
    publishedAt: timestamp({ withTimezone: true }),
    search: tsvector().generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body_markdown, ''))`,
    ),
    /** Portal reads, anonymous; known people's reads are in kb_article_views. */
    viewCount: integer().notNull().default(0),
    helpfulCount: integer().notNull().default(0),
    notHelpfulCount: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    unique('kb_articles_tenant_id_id_key').on(table.tenantId, table.id),
    uniqueIndex('kb_articles_slug_key')
      .on(table.tenantId, table.slug)
      .where(sql`${table.deletedAt} is null`),
    foreignKey({
      name: 'kb_articles_category_fkey',
      columns: [table.tenantId, table.categoryId],
      foreignColumns: [kbCategories.tenantId, kbCategories.id],
    }),
    index('kb_articles_list_idx')
      .on(table.tenantId, table.status, table.updatedAt)
      .where(sql`${table.deletedAt} is null`),
    index('kb_articles_search_idx').using('gin', table.search),
    check('kb_articles_status_check', sql`${table.status} in ('draft', 'published')`),
    check('kb_articles_slug_check', sql`${table.slug} ~ '^[a-z0-9]([a-z0-9-]{0,118}[a-z0-9])?$'`),
    check(
      'kb_articles_size_check',
      sql`char_length(${table.title}) between 1 and 200 and char_length(${table.bodyMarkdown}) <= 100000 and char_length(coalesce(${table.summary}, '')) <= 300`,
    ),
  ],
);

/** "Was this helpful?" from the portal: yes or no, and optionally why not. */
export const kbArticleFeedback = pgTable(
  'kb_article_feedback',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    articleId: uuid().notNull(),
    helpful: boolean().notNull(),
    comment: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'kb_article_feedback_article_fkey',
      columns: [table.tenantId, table.articleId],
      foreignColumns: [kbArticles.tenantId, kbArticles.id],
    }).onDelete('cascade'),
    index('kb_article_feedback_article_idx').on(table.tenantId, table.articleId, table.createdAt),
    check(
      'kb_article_feedback_comment_check',
      sql`char_length(coalesce(${table.comment}, '')) <= 1000`,
    ),
  ],
);

/**
 * A link to an article an agent put into a reply to a known customer (ADR-071). The address
 * carries a random token whose hash is kept here, never a person's id: opening it records that
 * this contact read the article.
 */
export const kbArticleLinks = pgTable(
  'kb_article_links',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    articleId: uuid().notNull(),
    contactId: uuid().notNull(),
    /** inbox | ticket */
    source: text().notNull(),
    conversationId: uuid(),
    ticketId: uuid(),
    /** sha256 of the token in the link, base64url. */
    tokenHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
  },
  (table) => [
    uniqueIndex('kb_article_links_token_key').on(table.tokenHash),
    foreignKey({
      name: 'kb_article_links_article_fkey',
      columns: [table.tenantId, table.articleId],
      foreignColumns: [kbArticles.tenantId, kbArticles.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'kb_article_links_contact_fkey',
      columns: [table.tenantId, table.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'kb_article_links_conversation_fkey',
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [socialConversations.tenantId, socialConversations.id],
    }),
    foreignKey({
      name: 'kb_article_links_ticket_fkey',
      columns: [table.tenantId, table.ticketId],
      foreignColumns: [tickets.tenantId, tickets.id],
    }),
    check('kb_article_links_source_check', sql`${table.source} in ('inbox', 'ticket')`),
  ],
);

/** A known contact opening an article through a link sent to them (at most one a link a day). */
export const kbArticleViews = pgTable(
  'kb_article_views',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    articleId: uuid().notNull(),
    contactId: uuid().notNull(),
    linkId: uuid().notNull(),
    source: text().notNull(),
    viewedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'kb_article_views_article_fkey',
      columns: [table.tenantId, table.articleId],
      foreignColumns: [kbArticles.tenantId, kbArticles.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'kb_article_views_contact_fkey',
      columns: [table.tenantId, table.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'kb_article_views_link_fkey',
      columns: [table.linkId],
      foreignColumns: [kbArticleLinks.id],
    }).onDelete('cascade'),
    index('kb_article_views_contact_idx').on(table.tenantId, table.contactId, table.viewedAt),
  ],
);
