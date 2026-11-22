import 'server-only';

import { and, asc, desc, eq, gte, ilike, isNull, or, sql } from 'drizzle-orm';
import { cache } from 'react';

import {
  kbArticleFeedback,
  kbArticleLinks,
  kbArticles,
  kbArticleViews,
  kbCategories,
  kbPortals,
  tenants,
} from '@/db/schema';
import { AppError } from '@/lib/errors';
import { OPEN_TENANT_STATUSES } from '@/lib/tenant/status';
import { adminDb } from '@/server/db/admin';
import { consumeRateLimit, enforceRateLimit } from '@/server/rate-limit';

import { hashLinkToken } from './link-token';

/*
 * The public help portal (ADR-071): the only knowledge base code that uses the privileged
 * connection. Everything starts from the business's slug and goes no further than a business
 * that is open, has the knowledge base switched on and its portal open, and articles that are
 * published. No business, article or contact id is ever taken from the visitor.
 */

/** Feedback one visitor may send an hour across a business's articles. */
const FEEDBACK_HOURLY = 20;
/** Reads one visitor may add to a business's counters an hour. */
const VIEWS_HOURLY = 120;

export type PublicPortal = {
  tenantId: string;
  slug: string;
  businessName: string;
  /** Dates on the portal are shown in the business's own timezone. */
  timezone: string;
  title: string;
  intro: string | null;
};

/** The open portal for a business slug, or null. */
async function findPublicPortal(slug: string): Promise<PublicPortal | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return null;
  const [row] = await adminDb()
    .select({
      tenantId: tenants.id,
      slug: tenants.slug,
      businessName: tenants.name,
      timezone: tenants.timezone,
      status: tenants.status,
      features: tenants.features,
      isPublic: kbPortals.isPublic,
      title: kbPortals.title,
      intro: kbPortals.intro,
    })
    .from(tenants)
    .innerJoin(kbPortals, eq(kbPortals.tenantId, tenants.id))
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (
    !row ||
    !row.isPublic ||
    !row.features.includes('knowledge_base') ||
    !(OPEN_TENANT_STATUSES as readonly string[]).includes(row.status)
  ) {
    return null;
  }
  return {
    tenantId: row.tenantId,
    slug: row.slug,
    businessName: row.businessName,
    timezone: row.timezone,
    title: row.title || `${row.businessName} help centre`,
    intro: row.intro,
  };
}

/** Once per request, shared by the portal's layout, page and metadata. */
export const getPublicPortal = cache(findPublicPortal);

const published = (tenantId: string) =>
  and(
    eq(kbArticles.tenantId, tenantId),
    eq(kbArticles.status, 'published'),
    isNull(kbArticles.deletedAt),
  );

/** `%` and `_` typed into the search are searched for, not wildcards. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

/** The portal's home: its categories with their articles, or what a search found. */
export async function listPublicArticles(portal: PublicPortal, q?: string) {
  const db = adminDb();
  const query = q?.trim().slice(0, 100) || null;
  const articles = await db
    .select({
      title: kbArticles.title,
      slug: kbArticles.slug,
      summary: kbArticles.summary,
      categoryId: kbArticles.categoryId,
    })
    .from(kbArticles)
    .where(
      and(
        published(portal.tenantId),
        query
          ? or(
              ilike(kbArticles.title, like(query)),
              sql`${kbArticles.search} @@ websearch_to_tsquery('simple', ${query})`,
            )
          : undefined,
      ),
    )
    .orderBy(
      query
        ? sql`ts_rank(${kbArticles.search}, websearch_to_tsquery('simple', ${query})) desc`
        : asc(kbArticles.title),
      asc(kbArticles.title),
    )
    .limit(query ? 30 : 500);
  const categories = await db
    .select({
      id: kbCategories.id,
      name: kbCategories.name,
      slug: kbCategories.slug,
      description: kbCategories.description,
    })
    .from(kbCategories)
    .where(and(eq(kbCategories.tenantId, portal.tenantId), isNull(kbCategories.deletedAt)))
    .orderBy(asc(kbCategories.position), asc(kbCategories.name));
  return { articles, categories };
}

/** One published article by its address, or null. */
export async function getPublicArticle(portal: PublicPortal, articleSlug: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(articleSlug)) return null;
  const [article] = await adminDb()
    .select({
      id: kbArticles.id,
      title: kbArticles.title,
      slug: kbArticles.slug,
      summary: kbArticles.summary,
      bodyMarkdown: kbArticles.bodyMarkdown,
      updatedAt: kbArticles.updatedAt,
      publishedAt: kbArticles.publishedAt,
      categoryName: kbCategories.name,
    })
    .from(kbArticles)
    .leftJoin(
      kbCategories,
      and(
        eq(kbCategories.tenantId, kbArticles.tenantId),
        eq(kbCategories.id, kbArticles.categoryId),
      ),
    )
    .where(and(published(portal.tenantId), eq(kbArticles.slug, articleSlug)))
    .limit(1);
  return article ?? null;
}

/** Every published article's address and last change, for the portal's sitemap. */
export async function listSitemapArticles(portal: PublicPortal) {
  return adminDb()
    .select({ slug: kbArticles.slug, updatedAt: kbArticles.updatedAt })
    .from(kbArticles)
    .where(published(portal.tenantId))
    .orderBy(desc(kbArticles.updatedAt))
    .limit(5000);
}

/**
 * The article page reports that it was shown in a browser (not fetched by a mail scanner or a
 * crawler that runs no script): the article's read count goes up, and when the page was opened
 * from a link sent to a known customer, their read is recorded, once a link a day.
 */
export async function recordArticleView(
  portal: PublicPortal,
  input: { article: string; ref?: string | undefined },
  sender: string | null,
): Promise<void> {
  const article = await getPublicArticle(portal, input.article);
  if (!article) return;
  const counted = await consumeRateLimit({
    bucket: `kb-view:${portal.tenantId}`,
    subject: sender,
    limit: VIEWS_HOURLY,
    windowSeconds: 3600,
  });
  if (!counted) return;
  const db = adminDb();
  await db
    .update(kbArticles)
    .set({ viewCount: sql`${kbArticles.viewCount} + 1` })
    .where(and(eq(kbArticles.tenantId, portal.tenantId), eq(kbArticles.id, article.id)));
  if (!input.ref) return;
  const [link] = await db
    .select({
      id: kbArticleLinks.id,
      contactId: kbArticleLinks.contactId,
      source: kbArticleLinks.source,
    })
    .from(kbArticleLinks)
    .where(
      and(
        eq(kbArticleLinks.tokenHash, hashLinkToken(input.ref)),
        // The link must be this business's, for this very article, and still live.
        eq(kbArticleLinks.tenantId, portal.tenantId),
        eq(kbArticleLinks.articleId, article.id),
        gte(kbArticleLinks.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!link) return;
  const [recent] = await db
    .select({ id: kbArticleViews.id })
    .from(kbArticleViews)
    .where(
      and(
        eq(kbArticleViews.linkId, link.id),
        gte(kbArticleViews.viewedAt, new Date(Date.now() - 86_400_000)),
      ),
    )
    .limit(1);
  if (recent) return;
  await db.insert(kbArticleViews).values({
    tenantId: portal.tenantId,
    articleId: article.id,
    contactId: link.contactId,
    linkId: link.id,
    source: link.source,
  });
}

/** "Was this helpful?": the tally, and the reason when someone says no. */
export async function submitArticleFeedback(
  portal: PublicPortal,
  input: { article: string; helpful: boolean; comment: string | null },
  sender: string | null,
): Promise<void> {
  const article = await getPublicArticle(portal, input.article);
  if (!article) throw new AppError('NOT_FOUND', 'This article was not found.');
  await enforceRateLimit(
    {
      bucket: `kb-feedback:${portal.tenantId}`,
      subject: sender,
      limit: FEEDBACK_HOURLY,
      windowSeconds: 3600,
    },
    'Thanks, we have your feedback already. Please wait a while before sending more.',
  );
  await adminDb().transaction(async (tx) => {
    await tx.insert(kbArticleFeedback).values({
      tenantId: portal.tenantId,
      articleId: article.id,
      helpful: input.helpful,
      comment: input.helpful ? null : input.comment,
    });
    await tx
      .update(kbArticles)
      .set(
        input.helpful
          ? { helpfulCount: sql`${kbArticles.helpfulCount} + 1` }
          : { notHelpfulCount: sql`${kbArticles.notHelpfulCount} + 1` },
      )
      .where(and(eq(kbArticles.tenantId, portal.tenantId), eq(kbArticles.id, article.id)));
  });
}
