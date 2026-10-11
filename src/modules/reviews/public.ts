import 'server-only';

import { and, eq, gte, isNull, ne, sql } from 'drizzle-orm';

import { auditLogs, contacts, customerReviews, reviewLinks, tenants } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { adminDb } from '@/server/db/admin';
import { enforceRateLimit } from '@/server/rate-limit';

import type { SubmitReviewInput } from './schemas';

/**
 * The public side of reviews: the page a customer reaches from a link or QR code. There is no
 * session, so this file uses the privileged client. It always starts from the link's token,
 * never accepts a business id from the caller, reads only the question and the business name,
 * and writes only a new review (ADR-036).
 */

/**
 * Reviews one sender may leave through a link per hour, and reviews one link accepts per hour
 * from everyone together. The per-sender limit stops one script using up the link's ceiling.
 */
const SENDER_HOURLY_LIMIT = 5;
const HOURLY_LIMIT = 200;

async function linkByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [row] = await adminDb()
    .select({
      id: reviewLinks.id,
      tenantId: reviewLinks.tenantId,
      prompt: reviewLinks.prompt,
      businessName: tenants.name,
    })
    .from(reviewLinks)
    .innerJoin(tenants, eq(tenants.id, reviewLinks.tenantId))
    .where(
      and(
        eq(reviewLinks.publicToken, token),
        eq(reviewLinks.isActive, true),
        isNull(reviewLinks.deletedAt),
        ne(tenants.status, 'suspended'),
        sql`'reviews' = any(${tenants.features})`,
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getPublicReviewLink(
  token: string,
): Promise<{ prompt: string; businessName: string } | null> {
  const row = await linkByToken(token);
  return row ? { prompt: row.prompt, businessName: row.businessName } : null;
}

export async function submitReview(
  token: string,
  input: SubmitReviewInput,
  sender: string | null,
): Promise<void> {
  const link = await linkByToken(token);
  if (!link) throw new AppError('NOT_FOUND', 'This review page is no longer available.');
  await enforceRateLimit(
    {
      bucket: `reviews:${link.id}`,
      subject: sender,
      limit: SENDER_HOURLY_LIMIT,
      windowSeconds: 3600,
    },
    'Thank you — you have already sent several reviews. Please try again later.',
  );
  const db = adminDb();

  const [recent] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(customerReviews)
    .where(
      and(
        eq(customerReviews.tenantId, link.tenantId),
        eq(customerReviews.reviewLinkId, link.id),
        gte(customerReviews.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
      ),
    );
  if ((recent?.total ?? 0) >= HOURLY_LIMIT) {
    throw new AppError(
      'RATE_LIMITED',
      'We are receiving a lot of reviews right now. Try again later.',
    );
  }

  // Tie the review to the customer's record when the business already knows that email.
  const email = input.customerEmail?.toLowerCase() ?? null;
  const [contact] = email
    ? await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.tenantId, link.tenantId),
            eq(contacts.emailNormalized, email),
            isNull(contacts.deletedAt),
          ),
        )
        .limit(1)
    : [];

  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(customerReviews)
      .values({
        tenantId: link.tenantId,
        reviewLinkId: link.id,
        rating: input.rating,
        comment: input.comment,
        customerName: input.customerName,
        customerEmail: email,
        // Consent only means something when there is a way to reach them.
        contactAllowed: Boolean(email) && input.contactAllowed,
        contactId: contact?.id ?? null,
      })
      .returning({ id: customerReviews.id });
    await tx.insert(auditLogs).values({
      tenantId: link.tenantId,
      actorUserId: null,
      actorType: 'system',
      action: 'create',
      entityType: 'customer_review',
      entityId: created?.id ?? null,
      context: { source: 'review_link' },
    });
  });
}
