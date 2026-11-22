import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import {
  kbArticleLinks,
  kbArticles,
  kbCategories,
  kbPortals,
  socialConversations,
  tickets,
} from '@/db/schema';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import { hashLinkToken, newLinkToken } from './link-token';
import { articleUrl } from './queries';
import {
  articleSlug,
  type ArticleInput,
  type ArticleLinkInput,
  type CategoryInput,
  type PortalInput,
} from './schemas';

/*
 * Writing the knowledge base (ADR-071): articles, categories and the portal's settings, with
 * kb.manage; and links to published articles that people who answer customers put in replies.
 */

/** How long a tracked link keeps recording that its customer read the article. */
const LINK_DAYS = 365;

function pgCode(error: unknown): string | undefined {
  return (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
}

async function assertCategory(tx: Tx, ctx: TenantContext, categoryId: string | null) {
  if (!categoryId) return;
  const [category] = await tx
    .select({ id: kbCategories.id })
    .from(kbCategories)
    .where(
      and(
        eq(kbCategories.tenantId, ctx.tenantId),
        eq(kbCategories.id, categoryId),
        isNull(kbCategories.deletedAt),
      ),
    )
    .limit(1);
  if (!category) {
    throw new AppError('VALIDATION', 'Choose one of your categories.', {
      categoryId: ['Choose one of your categories.'],
    });
  }
}

/**
 * Creates or changes an article. Its address comes from the title unless one is given, and is
 * unique among the business's articles. Publishing it the first time dates it.
 */
export async function saveArticle(
  ctx: TenantContext,
  input: ArticleInput,
): Promise<{ id: string; slug: string }> {
  requirePermission(ctx, 'kb.manage');
  const slug = input.slug ?? articleSlug(input.title);
  if (!slug) {
    throw new AppError('VALIDATION', 'Give it an address.', { slug: ['Give it an address.'] });
  }
  const now = new Date();
  try {
    return await withRls(ctx, async (tx) => {
      await assertCategory(tx, ctx, input.categoryId);
      const values = {
        title: input.title,
        slug,
        categoryId: input.categoryId,
        summary: input.summary,
        bodyMarkdown: input.bodyMarkdown,
        status: input.status,
        updatedBy: ctx.userId,
        updatedAt: now,
      };
      if (!input.id) {
        const [created] = await tx
          .insert(kbArticles)
          .values({
            tenantId: ctx.tenantId,
            ...values,
            publishedAt: input.status === 'published' ? now : null,
            createdBy: ctx.userId,
          })
          .returning({ id: kbArticles.id });
        if (!created) throw new AppError('INTERNAL', 'The article could not be saved.');
        await audit(tx, ctx, {
          action: 'create',
          entityType: 'kb_article',
          entityId: created.id,
          changes: { title: [null, input.title], status: [null, input.status] },
        });
        return { id: created.id, slug };
      }
      const [existing] = await tx
        .select({
          id: kbArticles.id,
          title: kbArticles.title,
          status: kbArticles.status,
          publishedAt: kbArticles.publishedAt,
        })
        .from(kbArticles)
        .where(
          and(
            eq(kbArticles.tenantId, ctx.tenantId),
            eq(kbArticles.id, input.id),
            isNull(kbArticles.deletedAt),
          ),
        )
        .limit(1);
      if (!existing) throw new AppError('NOT_FOUND', 'That article was not found.');
      await tx
        .update(kbArticles)
        .set({
          ...values,
          publishedAt:
            input.status === 'published' ? (existing.publishedAt ?? now) : existing.publishedAt,
        })
        .where(and(eq(kbArticles.tenantId, ctx.tenantId), eq(kbArticles.id, existing.id)));
      await audit(tx, ctx, {
        action: 'update',
        entityType: 'kb_article',
        entityId: existing.id,
        changes: {
          title: [existing.title, input.title],
          status: [existing.status, input.status],
        },
      });
      return { id: existing.id, slug };
    });
  } catch (error) {
    if (pgCode(error) === '23505') {
      const message = 'Another article already has this address. Change it.';
      throw new AppError('DUPLICATE', message, { slug: [message] });
    }
    throw error;
  }
}

/** Removes an article from the portal and the editor (kept, soft-deleted, for its history). */
export async function deleteArticle(ctx: TenantContext, id: string): Promise<void> {
  requirePermission(ctx, 'kb.manage');
  await withRls(ctx, async (tx) => {
    const [gone] = await tx
      .update(kbArticles)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId, updatedAt: new Date() })
      .where(
        and(
          eq(kbArticles.tenantId, ctx.tenantId),
          eq(kbArticles.id, id),
          isNull(kbArticles.deletedAt),
        ),
      )
      .returning({ id: kbArticles.id });
    if (!gone) throw new AppError('NOT_FOUND', 'That article was not found.');
    await audit(tx, ctx, { action: 'delete', entityType: 'kb_article', entityId: id });
  });
}

export async function saveCategory(
  ctx: TenantContext,
  input: CategoryInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'kb.manage');
  const slug = input.slug ?? articleSlug(input.name, 80);
  if (!slug) throw new AppError('VALIDATION', 'Give it a name with letters or numbers.');
  try {
    return await withRls(ctx, async (tx) => {
      const values = {
        name: input.name,
        slug,
        description: input.description,
        position: input.position,
        updatedBy: ctx.userId,
        updatedAt: new Date(),
      };
      if (!input.id) {
        const [created] = await tx
          .insert(kbCategories)
          .values({ tenantId: ctx.tenantId, ...values, createdBy: ctx.userId })
          .returning({ id: kbCategories.id });
        await audit(tx, ctx, {
          action: 'create',
          entityType: 'kb_category',
          entityId: created!.id,
        });
        return { id: created!.id };
      }
      const [updated] = await tx
        .update(kbCategories)
        .set(values)
        .where(
          and(
            eq(kbCategories.tenantId, ctx.tenantId),
            eq(kbCategories.id, input.id),
            isNull(kbCategories.deletedAt),
          ),
        )
        .returning({ id: kbCategories.id });
      if (!updated) throw new AppError('NOT_FOUND', 'That category was not found.');
      await audit(tx, ctx, { action: 'update', entityType: 'kb_category', entityId: updated.id });
      return { id: updated.id };
    });
  } catch (error) {
    if (pgCode(error) === '23505') {
      throw new AppError('DUPLICATE', 'Another category already has this name.', {
        name: ['Another category already has this name.'],
      });
    }
    throw error;
  }
}

/** Removes a category; its articles stay, without one. */
export async function deleteCategory(ctx: TenantContext, id: string): Promise<void> {
  requirePermission(ctx, 'kb.manage');
  await withRls(ctx, async (tx) => {
    const [gone] = await tx
      .update(kbCategories)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId, updatedAt: new Date() })
      .where(
        and(
          eq(kbCategories.tenantId, ctx.tenantId),
          eq(kbCategories.id, id),
          isNull(kbCategories.deletedAt),
        ),
      )
      .returning({ id: kbCategories.id });
    if (!gone) throw new AppError('NOT_FOUND', 'That category was not found.');
    await tx
      .update(kbArticles)
      .set({ categoryId: null, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(kbArticles.tenantId, ctx.tenantId), eq(kbArticles.categoryId, id)));
    await audit(tx, ctx, { action: 'delete', entityType: 'kb_category', entityId: id });
  });
}

/** Opens or closes the public portal, and sets its title and introduction. */
export async function savePortal(ctx: TenantContext, input: PortalInput): Promise<void> {
  requirePermission(ctx, 'kb.manage');
  await withRls(ctx, async (tx) => {
    const [before] = await tx
      .select({ isPublic: kbPortals.isPublic })
      .from(kbPortals)
      .where(eq(kbPortals.tenantId, ctx.tenantId))
      .limit(1);
    const values = { ...input, updatedBy: ctx.userId, updatedAt: new Date() };
    await tx
      .insert(kbPortals)
      .values({ tenantId: ctx.tenantId, ...values })
      .onConflictDoUpdate({ target: kbPortals.tenantId, set: values });
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'kb_portal',
      entityId: null,
      changes: { isPublic: [before?.isPublic ?? false, input.isPublic] },
    });
  });
}

/**
 * A link to a published article for a reply (ADR-071). When the conversation or ticket belongs
 * to a known contact, the link carries a random token (only its hash is kept), so opening it
 * records that this contact read the article. Otherwise it is the article's plain address.
 */
export async function createArticleLink(
  ctx: TenantContext,
  input: ArticleLinkInput,
): Promise<{ url: string; title: string; tracked: boolean }> {
  if (input.conversationId) requirePermission(ctx, 'social.reply');
  else requirePermission(ctx, 'tickets.work');
  return withRls(ctx, async (tx) => {
    const [article] = await tx
      .select({ id: kbArticles.id, title: kbArticles.title, slug: kbArticles.slug })
      .from(kbArticles)
      .where(
        and(
          eq(kbArticles.tenantId, ctx.tenantId),
          eq(kbArticles.id, input.articleId),
          eq(kbArticles.status, 'published'),
          isNull(kbArticles.deletedAt),
        ),
      )
      .limit(1);
    if (!article) throw new AppError('NOT_FOUND', 'That article was not found.');

    let contactId: string | null = null;
    if (input.conversationId) {
      const [conversation] = await tx
        .select({ contactId: socialConversations.contactId })
        .from(socialConversations)
        .where(
          and(
            eq(socialConversations.tenantId, ctx.tenantId),
            eq(socialConversations.id, input.conversationId),
          ),
        )
        .limit(1);
      if (!conversation) throw new AppError('NOT_FOUND', 'That conversation was not found.');
      contactId = conversation.contactId;
    } else {
      const [ticket] = await tx
        .select({ contactId: tickets.contactId })
        .from(tickets)
        .where(
          and(
            eq(tickets.tenantId, ctx.tenantId),
            eq(tickets.id, input.ticketId!),
            isNull(tickets.deletedAt),
          ),
        )
        .limit(1);
      if (!ticket) throw new AppError('NOT_FOUND', 'That ticket was not found.');
      contactId = ticket.contactId;
    }

    // Records first (another business's are simply not found), then whether customers can open it.
    const [portal] = await tx
      .select({ isPublic: kbPortals.isPublic })
      .from(kbPortals)
      .where(eq(kbPortals.tenantId, ctx.tenantId))
      .limit(1);
    if (!portal?.isPublic) {
      throw new AppError('CONFLICT', 'Switch the help portal on first, so customers can open it.');
    }
    const plain = articleUrl(ctx.tenant.slug, article.slug);
    if (!contactId) return { url: plain, title: article.title, tracked: false };
    const token = newLinkToken();
    await tx.insert(kbArticleLinks).values({
      tenantId: ctx.tenantId,
      articleId: article.id,
      contactId,
      source: input.conversationId ? 'inbox' : 'ticket',
      conversationId: input.conversationId ?? null,
      ticketId: input.ticketId ?? null,
      tokenHash: hashLinkToken(token),
      expiresAt: new Date(Date.now() + LINK_DAYS * 86_400_000),
      createdBy: ctx.userId,
    });
    return { url: `${plain}?r=${token}`, title: article.title, tracked: true };
  });
}
