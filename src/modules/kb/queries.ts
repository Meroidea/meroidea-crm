import 'server-only';

import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';

import {
  kbArticleFeedback,
  kbArticles,
  kbArticleViews,
  kbCategories,
  kbPortals,
} from '@/db/schema';
import type { PermissionKey } from '@/lib/permissions/catalog';
import type { TimelineItem } from '@/modules/activities/types';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';
import { serverEnv } from '@/server/env';

import type { ArticleStatus } from './schemas';

/** Who may send article links: anyone who answers customers, and the editors. */
const ANSWERING = ['social.reply', 'tickets.work', 'kb.manage'] as const satisfies PermissionKey[];
/** Who sees what a contact read (their timeline and tickets). */
const READING_HISTORY = [
  'contacts.view',
  'tickets.work',
  'social.view',
] as const satisfies PermissionKey[];

/** The portal's address for this business, and an article's on it. */
export const portalUrl = (slug: string) => `${serverEnv().APP_URL}/help/${slug}`;
export const articleUrl = (tenantSlug: string, articleSlug: string) =>
  `${portalUrl(tenantSlug)}/${articleSlug}`;

/** `%` and `_` typed into a search are searched for, not wildcards. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

export type ArticleRow = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  status: ArticleStatus;
  categoryId: string | null;
  categoryName: string | null;
  viewCount: number;
  helpfulCount: number;
  notHelpfulCount: number;
  updatedAt: Date;
  publishedAt: Date | null;
};

/** The editor's list: every article, newest change first, optionally searched. */
export async function listArticles(
  ctx: TenantContext,
  options: { q?: string; status?: ArticleStatus } = {},
): Promise<ArticleRow[]> {
  requirePermission(ctx, 'kb.manage');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        id: kbArticles.id,
        title: kbArticles.title,
        slug: kbArticles.slug,
        summary: kbArticles.summary,
        status: kbArticles.status,
        categoryId: kbArticles.categoryId,
        categoryName: kbCategories.name,
        viewCount: kbArticles.viewCount,
        helpfulCount: kbArticles.helpfulCount,
        notHelpfulCount: kbArticles.notHelpfulCount,
        updatedAt: kbArticles.updatedAt,
        publishedAt: kbArticles.publishedAt,
      })
      .from(kbArticles)
      .leftJoin(
        kbCategories,
        and(
          eq(kbCategories.tenantId, kbArticles.tenantId),
          eq(kbCategories.id, kbArticles.categoryId),
        ),
      )
      .where(
        and(
          eq(kbArticles.tenantId, ctx.tenantId),
          isNull(kbArticles.deletedAt),
          options.status ? eq(kbArticles.status, options.status) : undefined,
          options.q
            ? or(
                ilike(kbArticles.title, like(options.q)),
                sql`${kbArticles.search} @@ websearch_to_tsquery('simple', ${options.q})`,
              )
            : undefined,
        ),
      )
      .orderBy(desc(kbArticles.updatedAt))
      .limit(500),
  );
  return rows as ArticleRow[];
}

export async function getArticle(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'kb.manage');
  return withRls(ctx, async (tx) => {
    const [article] = await tx
      .select()
      .from(kbArticles)
      .where(
        and(
          eq(kbArticles.tenantId, ctx.tenantId),
          eq(kbArticles.id, id),
          isNull(kbArticles.deletedAt),
        ),
      )
      .limit(1);
    if (!article) return null;
    const feedback = await tx
      .select({
        helpful: kbArticleFeedback.helpful,
        comment: kbArticleFeedback.comment,
        createdAt: kbArticleFeedback.createdAt,
      })
      .from(kbArticleFeedback)
      .where(
        and(
          eq(kbArticleFeedback.tenantId, ctx.tenantId),
          eq(kbArticleFeedback.articleId, id),
          sql`${kbArticleFeedback.comment} is not null`,
        ),
      )
      .orderBy(desc(kbArticleFeedback.createdAt))
      .limit(20);
    return { ...article, status: article.status as ArticleStatus, feedback };
  });
}

export async function listCategories(ctx: TenantContext) {
  if (!hasPermission(ctx, 'kb.manage')) requirePermission(ctx, 'tickets.work');
  return withRls(ctx, (tx) =>
    tx
      .select({
        id: kbCategories.id,
        name: kbCategories.name,
        slug: kbCategories.slug,
        description: kbCategories.description,
        position: kbCategories.position,
        // Written out in full: in a one-table select Drizzle leaves columns unqualified, which
        // inside a subquery would bind to the inner table and always count nothing.
        articles: sql<number>`(select count(*)::int from public.kb_articles a
          where a.tenant_id = kb_categories.tenant_id and a.category_id = kb_categories.id
            and a.deleted_at is null)`,
      })
      .from(kbCategories)
      .where(and(eq(kbCategories.tenantId, ctx.tenantId), isNull(kbCategories.deletedAt)))
      .orderBy(asc(kbCategories.position), asc(kbCategories.name)),
  );
}

export async function getPortalSettings(ctx: TenantContext) {
  requirePermission(ctx, 'kb.manage');
  const [portal] = await withRls(ctx, (tx) =>
    tx.select().from(kbPortals).where(eq(kbPortals.tenantId, ctx.tenantId)).limit(1),
  );
  return {
    isPublic: portal?.isPublic ?? false,
    title: portal?.title ?? null,
    intro: portal?.intro ?? null,
    url: portalUrl(ctx.tenant.slug),
  };
}

/**
 * Published articles matching what an agent typed, to send a link in a reply (ADR-071). Readable
 * by anyone who answers customers; drafts never appear (RLS keeps them to editors as well).
 */
export async function searchPublishedArticles(
  ctx: TenantContext,
  q: string,
): Promise<{ id: string; title: string; summary: string | null }[]> {
  if (!ANSWERING.some((key) => hasPermission(ctx, key))) requirePermission(ctx, 'social.reply');
  return withRls(ctx, (tx) =>
    tx
      .select({ id: kbArticles.id, title: kbArticles.title, summary: kbArticles.summary })
      .from(kbArticles)
      .where(
        and(
          eq(kbArticles.tenantId, ctx.tenantId),
          eq(kbArticles.status, 'published'),
          isNull(kbArticles.deletedAt),
          q
            ? or(
                ilike(kbArticles.title, like(q)),
                sql`${kbArticles.search} @@ websearch_to_tsquery('simple', ${q})`,
              )
            : undefined,
        ),
      )
      .orderBy(
        q
          ? sql`ts_rank(${kbArticles.search}, websearch_to_tsquery('simple', ${q})) desc`
          : desc(kbArticles.viewCount),
        asc(kbArticles.title),
      )
      .limit(8),
  );
}

/**
 * Which articles a contact read through links sent to them (ADR-071): for their timeline and
 * their tickets. Empty where the knowledge base is off or the person may not see it.
 */
export async function articleViewsForContact(
  ctx: TenantContext,
  contactId: string,
  limit = 20,
): Promise<{ id: string; articleId: string; title: string; slug: string; viewedAt: Date }[]> {
  if (!ctx.tenant.features.includes('knowledge_base')) return [];
  if (!READING_HISTORY.some((key) => hasPermission(ctx, key))) return [];
  return withRls(ctx, (tx) =>
    tx
      .select({
        id: kbArticleViews.id,
        articleId: kbArticles.id,
        title: kbArticles.title,
        slug: kbArticles.slug,
        viewedAt: kbArticleViews.viewedAt,
      })
      .from(kbArticleViews)
      .innerJoin(
        kbArticles,
        and(
          eq(kbArticles.tenantId, kbArticleViews.tenantId),
          eq(kbArticles.id, kbArticleViews.articleId),
        ),
      )
      .where(
        and(eq(kbArticleViews.tenantId, ctx.tenantId), eq(kbArticleViews.contactId, contactId)),
      )
      .orderBy(desc(kbArticleViews.viewedAt))
      .limit(limit),
  );
}

/** The same reads as timeline items, linking to the article on the portal. */
export async function articleViewsTimeline(
  ctx: TenantContext,
  contactId: string,
): Promise<TimelineItem[]> {
  const views = await articleViewsForContact(ctx, contactId);
  return views.map((view) => ({
    id: `kb-view-${view.id}`,
    type: 'kb_viewed',
    subject: `Read the help article “${view.title}”`,
    body: null,
    outcome: null,
    direction: null,
    occurredAt: view.viewedAt,
    actorName: null,
    contactId,
    contactName: null,
    opportunityId: null,
    opportunityName: null,
    href: articleUrl(ctx.tenant.slug, view.slug),
    hrefLabel: 'Open the article',
  }));
}
