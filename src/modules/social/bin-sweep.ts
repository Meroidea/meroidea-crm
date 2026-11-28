import 'server-only';

import { and, isNotNull, lt, sql } from 'drizzle-orm';

import { auditLogs, socialConversations } from '@/db/schema';
import { adminDb } from '@/server/db/admin';
import { removeSocialMedia } from '@/server/storage';

import { EMAIL_BIN_DAYS } from './schemas';

/**
 * The daily sweep (cron): every business's email threads that have been in the Bin longer than
 * 30 days, deleted for good with their files. Privileged, so it runs only from the scheduler's
 * route; each thread writes a system audit row.
 */
export async function purgeExpiredEmailBin(
  now = new Date(),
  limit = 500,
): Promise<{ deleted: number; files: number }> {
  const db = adminDb();
  const cutoff = new Date(now.getTime() - EMAIL_BIN_DAYS * 24 * 60 * 60 * 1000);
  const expired = await db
    .select({ tenantId: socialConversations.tenantId, id: socialConversations.id })
    .from(socialConversations)
    .where(and(isNotNull(socialConversations.deletedAt), lt(socialConversations.deletedAt, cutoff)))
    .limit(limit);
  let files = 0;
  for (const thread of expired) {
    const paths = await db.transaction(async (tx) => {
      const rows = (await tx.execute(
        sql`select path from app.email_delete_thread_rows(${thread.tenantId}::uuid, ${thread.id}::uuid) as path`,
      )) as unknown as { path: string }[];
      await tx.insert(auditLogs).values({
        tenantId: thread.tenantId,
        actorUserId: null,
        actorType: 'system',
        action: 'delete',
        entityType: 'social_conversation',
        entityId: thread.id,
        context: { permanent: true, bin: 'expired' },
      });
      return rows.map((row) => row.path);
    });
    if (paths.length > 0) files += await removeSocialMedia(paths);
  }
  return { deleted: expired.length, files };
}
