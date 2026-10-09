import 'server-only';

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { customerReviews, reviewLinks } from '@/db/schema';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { ReviewStatus } from './schemas';

export type ReviewLinkRow = {
  id: string;
  name: string;
  prompt: string;
  publicToken: string;
  isActive: boolean;
  reviews: number;
  average: string | null;
};

export async function listReviewLinks(ctx: TenantContext): Promise<ReviewLinkRow[]> {
  requirePermission(ctx, 'reviews.view');
  return withRls(ctx, (tx) =>
    tx
      .select({
        id: reviewLinks.id,
        name: reviewLinks.name,
        prompt: reviewLinks.prompt,
        publicToken: reviewLinks.publicToken,
        isActive: reviewLinks.isActive,
        reviews: sql<number>`(select count(*)::int from customer_reviews r
          where r.tenant_id = review_links.tenant_id and r.review_link_id = review_links.id
            and r.deleted_at is null)`,
        average: sql<string | null>`(select round(avg(r.rating), 1)::text from customer_reviews r
          where r.tenant_id = review_links.tenant_id and r.review_link_id = review_links.id
            and r.deleted_at is null)`,
      })
      .from(reviewLinks)
      .where(and(eq(reviewLinks.tenantId, ctx.tenantId), isNull(reviewLinks.deletedAt)))
      .orderBy(asc(reviewLinks.createdAt)),
  );
}

export type ReviewRow = {
  id: string;
  rating: number;
  comment: string | null;
  customerName: string | null;
  customerEmail: string | null;
  contactAllowed: boolean;
  contactId: string | null;
  status: ReviewStatus;
  internalNote: string | null;
  linkName: string;
  createdAt: Date;
};

export async function listReviews(
  ctx: TenantContext,
  filters: { status?: ReviewStatus | undefined; rating?: number | undefined } = {},
): Promise<ReviewRow[]> {
  requirePermission(ctx, 'reviews.view');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        id: customerReviews.id,
        rating: customerReviews.rating,
        comment: customerReviews.comment,
        customerName: customerReviews.customerName,
        customerEmail: customerReviews.customerEmail,
        contactAllowed: customerReviews.contactAllowed,
        contactId: customerReviews.contactId,
        status: customerReviews.status,
        internalNote: customerReviews.internalNote,
        linkName: reviewLinks.name,
        createdAt: customerReviews.createdAt,
      })
      .from(customerReviews)
      .innerJoin(
        reviewLinks,
        and(
          eq(reviewLinks.tenantId, customerReviews.tenantId),
          eq(reviewLinks.id, customerReviews.reviewLinkId),
        ),
      )
      .where(
        and(
          eq(customerReviews.tenantId, ctx.tenantId),
          isNull(customerReviews.deletedAt),
          filters.status ? eq(customerReviews.status, filters.status) : undefined,
          filters.rating ? eq(customerReviews.rating, filters.rating) : undefined,
        ),
      )
      .orderBy(desc(customerReviews.createdAt))
      .limit(200),
  );
  return rows as ReviewRow[];
}

export type ReviewSummary = {
  total: number;
  average: string | null;
  last30: number;
  average30: string | null;
  waiting: number;
  /** How many reviews gave 1, 2, 3, 4 and 5 stars, in that order. */
  distribution: [number, number, number, number, number];
};

export async function getReviewSummary(ctx: TenantContext): Promise<ReviewSummary> {
  requirePermission(ctx, 'reviews.view');
  const recent = sql`${customerReviews.createdAt} >= now() - interval '30 days'`;
  const stars = (value: number) =>
    sql<number>`count(*) filter (where ${customerReviews.rating} = ${value})::int`;
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({
        total: sql<number>`count(*)::int`,
        average: sql<string | null>`round(avg(${customerReviews.rating}), 1)::text`,
        last30: sql<number>`count(*) filter (where ${recent})::int`,
        average30: sql<
          string | null
        >`round(avg(${customerReviews.rating}) filter (where ${recent}), 1)::text`,
        waiting: sql<number>`count(*) filter (where ${customerReviews.status} = 'new')::int`,
        one: stars(1),
        two: stars(2),
        three: stars(3),
        four: stars(4),
        five: stars(5),
      })
      .from(customerReviews)
      .where(and(eq(customerReviews.tenantId, ctx.tenantId), isNull(customerReviews.deletedAt))),
  );
  return {
    total: row?.total ?? 0,
    average: row?.average ?? null,
    last30: row?.last30 ?? 0,
    average30: row?.average30 ?? null,
    waiting: row?.waiting ?? 0,
    distribution: [row?.one ?? 0, row?.two ?? 0, row?.three ?? 0, row?.four ?? 0, row?.five ?? 0],
  };
}
