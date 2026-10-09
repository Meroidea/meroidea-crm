import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import { customerReviews, reviewLinks } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { HandleReviewInput, SaveLinkInput } from './schemas';

/** Creates a review link (with its own public address and QR code), or edits one. */
export async function saveReviewLink(
  ctx: TenantContext,
  input: SaveLinkInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'reviews.manage');
  const values = { name: input.name, prompt: input.prompt, isActive: input.isActive };
  return withRls(ctx, async (tx) => {
    const [saved] = input.id
      ? await tx
          .update(reviewLinks)
          .set(values)
          .where(
            and(
              eq(reviewLinks.tenantId, ctx.tenantId),
              eq(reviewLinks.id, input.id),
              isNull(reviewLinks.deletedAt),
            ),
          )
          .returning({ id: reviewLinks.id })
      : await tx
          .insert(reviewLinks)
          .values({
            tenantId: ctx.tenantId,
            ...values,
            publicToken: randomBytes(15).toString('base64url'),
            createdBy: ctx.userId,
          })
          .returning({ id: reviewLinks.id });
    if (!saved) throw new AppError('NOT_FOUND', 'That review link was not found.');
    await audit(tx, ctx, {
      action: input.id ? 'update' : 'create',
      entityType: 'review_link',
      entityId: saved.id,
    });
    return saved;
  });
}

/** Marks a review as read or followed up, with a private note about what was done. */
export async function handleReview(
  ctx: TenantContext,
  input: HandleReviewInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'reviews.manage');
  return withRls(ctx, async (tx) => {
    const [updated] = await tx
      .update(customerReviews)
      .set({
        status: input.status,
        internalNote: input.internalNote,
        handledBy: ctx.userId,
        handledAt: new Date(),
      })
      .where(
        and(
          eq(customerReviews.tenantId, ctx.tenantId),
          eq(customerReviews.id, input.id),
          isNull(customerReviews.deletedAt),
        ),
      )
      .returning({ id: customerReviews.id });
    if (!updated) throw new AppError('NOT_FOUND', 'That review was not found.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'customer_review',
      entityId: updated.id,
      context: { status: input.status },
    });
    return updated;
  });
}

/** Removes a review, for spam or when the customer asks for it to be taken down. */
export async function deleteReview(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'reviews.manage');
  return withRls(ctx, async (tx) => {
    const [updated] = await tx
      .update(customerReviews)
      .set({ deletedAt: new Date(), customerName: null, customerEmail: null })
      .where(
        and(
          eq(customerReviews.tenantId, ctx.tenantId),
          eq(customerReviews.id, id),
          isNull(customerReviews.deletedAt),
        ),
      )
      .returning({ id: customerReviews.id });
    if (!updated) throw new AppError('NOT_FOUND', 'That review was not found.');
    await audit(tx, ctx, { action: 'delete', entityType: 'customer_review', entityId: updated.id });
    return updated;
  });
}
