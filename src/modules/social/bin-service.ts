import 'server-only';

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { socialAccounts, socialConversations } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';
import { removeSocialMedia } from '@/server/storage';

import { EMAIL_BIN_DAYS, type EmailImportantInput, type EmailThreadsInput } from './schemas';

/*
 * The Email area's Bin and Important (ADR-093).
 * - Delete puts an email thread in the Bin, for the whole team. It is restorable for 30 days,
 *   then deleted for good with its messages and files by the daily sweep. A new email from the
 *   customer takes it out of the Bin (webhooks.ts), so nothing they send is hidden.
 * - "Delete forever" and "Empty Bin" need `social.manage`: they cannot be undone.
 * - Important is a flag on the thread, for the whole team.
 * - The database stamps the Bin time itself and refuses either change on a non-email thread
 *   (`app.social_conversations_bin_guard`), so the 30 days cannot be shortened from a session.
 */

/** The email threads among `ids` that this person can see, under RLS. */
async function emailThreads(
  tx: Parameters<Parameters<typeof withRls>[1]>[0],
  ctx: TenantContext,
  ids: string[],
) {
  return tx
    .select({ id: socialConversations.id, deletedAt: socialConversations.deletedAt })
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
        inArray(socialConversations.id, ids),
        eq(socialAccounts.platform, 'email'),
      ),
    );
}

/** Moves email threads to the Bin. Threads already there, or not found, are left alone. */
export async function binEmailThreads(
  ctx: TenantContext,
  input: EmailThreadsInput,
): Promise<{ binned: number }> {
  requirePermission(ctx, 'social.reply');
  return withRls(ctx, async (tx) => {
    const found = (await emailThreads(tx, ctx, input.conversationIds)).filter(
      (thread) => thread.deletedAt === null,
    );
    if (found.length === 0) throw new AppError('NOT_FOUND', 'That email was not found.');
    const ids = found.map((thread) => thread.id);
    await tx
      .update(socialConversations)
      // The database replaces this with its own clock (bin guard).
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(socialConversations.tenantId, ctx.tenantId), inArray(socialConversations.id, ids)),
      );
    for (const id of ids) {
      await audit(tx, ctx, {
        action: 'delete',
        entityType: 'social_conversation',
        entityId: id,
        context: { bin: true },
      });
    }
    return { binned: ids.length };
  });
}

/** Takes email threads out of the Bin, back to the folder they belong in. */
export async function restoreEmailThreads(
  ctx: TenantContext,
  input: EmailThreadsInput,
): Promise<{ restored: number }> {
  requirePermission(ctx, 'social.reply');
  return withRls(ctx, async (tx) => {
    const found = (await emailThreads(tx, ctx, input.conversationIds)).filter(
      (thread) => thread.deletedAt !== null,
    );
    if (found.length === 0) throw new AppError('NOT_FOUND', 'That email is not in the Bin.');
    const ids = found.map((thread) => thread.id);
    await tx
      .update(socialConversations)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(
        and(eq(socialConversations.tenantId, ctx.tenantId), inArray(socialConversations.id, ids)),
      );
    for (const id of ids) {
      await audit(tx, ctx, {
        action: 'restore',
        entityType: 'social_conversation',
        entityId: id,
      });
    }
    return { restored: ids.length };
  });
}

/** Marks email threads important, or not, for the whole team. */
export async function setEmailImportant(
  ctx: TenantContext,
  input: EmailImportantInput,
): Promise<{ changed: number }> {
  requirePermission(ctx, 'social.reply');
  return withRls(ctx, async (tx) => {
    const found = await emailThreads(tx, ctx, input.conversationIds);
    if (found.length === 0) throw new AppError('NOT_FOUND', 'That email was not found.');
    const ids = found.map((thread) => thread.id);
    await tx
      .update(socialConversations)
      .set({ important: input.important, updatedAt: new Date() })
      .where(
        and(eq(socialConversations.tenantId, ctx.tenantId), inArray(socialConversations.id, ids)),
      );
    for (const id of ids) {
      await audit(tx, ctx, {
        action: 'update',
        entityType: 'social_conversation',
        entityId: id,
        changes: { important: [!input.important, input.important] },
      });
    }
    return { changed: ids.length };
  });
}

/**
 * Deletes email threads in the Bin for good, now: their messages, and their files in storage
 * once the rows are gone. Needs `social.manage`. Threads not in the Bin are refused by the
 * database function, so this cannot skip the Bin.
 */
export async function purgeEmailThreads(
  ctx: TenantContext,
  input: EmailThreadsInput,
): Promise<{ deleted: number }> {
  requirePermission(ctx, 'social.manage');
  const { ids, paths } = await withRls(ctx, async (tx) => {
    const found = (await emailThreads(tx, ctx, input.conversationIds)).filter(
      (thread) => thread.deletedAt !== null,
    );
    if (found.length === 0) throw new AppError('NOT_FOUND', 'That email is not in the Bin.');
    const removed: string[] = [];
    for (const thread of found) {
      const rows = (await tx.execute(
        sql`select path from app.email_purge_thread(${thread.id}::uuid) as path`,
      )) as unknown as { path: string }[];
      removed.push(...rows.map((row) => row.path));
      await audit(tx, ctx, {
        action: 'delete',
        entityType: 'social_conversation',
        entityId: thread.id,
        context: { permanent: true },
      });
    }
    return { ids: found.map((thread) => thread.id), paths: removed };
  });
  // After the commit: a file whose row is gone can only be orphaned, never shown.
  if (paths.length > 0) await removeSocialMedia(paths);
  return { deleted: ids.length };
}

/** Everything in the Bin, deleted for good (at most 200 threads at a time). */
export async function emptyEmailBin(ctx: TenantContext): Promise<{ deleted: number }> {
  requirePermission(ctx, 'social.manage');
  const binned = await withRls(ctx, (tx) =>
    tx
      .select({ id: socialConversations.id })
      .from(socialConversations)
      .where(
        and(
          eq(socialConversations.tenantId, ctx.tenantId),
          isNotNull(socialConversations.deletedAt),
        ),
      )
      .limit(200),
  );
  if (binned.length === 0) return { deleted: 0 };
  let deleted = 0;
  for (let at = 0; at < binned.length; at += 100) {
    const chunk = binned.slice(at, at + 100).map((row) => row.id);
    deleted += (await purgeEmailThreads(ctx, { conversationIds: chunk })).deleted;
  }
  return { deleted };
}

/** When a thread in the Bin is deleted for good: 30 days after it went in. */
export function purgeDate(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + EMAIL_BIN_DAYS * 24 * 60 * 60 * 1000);
}
