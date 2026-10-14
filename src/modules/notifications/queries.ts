import 'server-only';

import { and, count, desc, eq, isNull } from 'drizzle-orm';

import { notifications } from '@/db/schema';
import type { TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  url: string | null;
  readAt: Date | null;
  createdAt: Date;
};

/** The signed-in person's unread notices (RLS shows nobody else's). */
export async function countUnread(ctx: TenantContext): Promise<number> {
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({ total: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, ctx.tenantId),
          eq(notifications.userId, ctx.userId),
          isNull(notifications.readAt),
        ),
      ),
  );
  return row?.total ?? 0;
}

export async function listNotifications(
  ctx: TenantContext,
  limit = 100,
): Promise<NotificationRow[]> {
  return withRls(ctx, (tx) =>
    tx
      .select({
        id: notifications.id,
        type: notifications.type,
        title: notifications.title,
        body: notifications.body,
        url: notifications.url,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(and(eq(notifications.tenantId, ctx.tenantId), eq(notifications.userId, ctx.userId)))
      .orderBy(desc(notifications.createdAt))
      .limit(limit),
  );
}
