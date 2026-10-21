import 'server-only';

import { eq } from 'drizzle-orm';

import { users } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import type { TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { updateMyProfileSchema } from './schemas';
import type { z } from 'zod';

/**
 * A person changes their own name and phone. RLS (`users_update_self`) already limits the update
 * to their own row; the audit entry records which fields changed, in the business they were in.
 */
export async function updateMyProfile(
  ctx: TenantContext,
  input: z.output<typeof updateMyProfileSchema>,
): Promise<void> {
  await withRls(ctx, async (tx) => {
    const [before] = await tx
      .select({ fullName: users.fullName, phone: users.phone })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);
    if (!before) throw new AppError('NOT_FOUND', 'Your details were not found.');

    const changes: Record<string, [unknown, unknown]> = {};
    if (before.fullName !== input.fullName) changes.fullName = [before.fullName, input.fullName];
    if (before.phone !== input.phone) changes.phone = [before.phone, input.phone];
    if (Object.keys(changes).length === 0) return;

    await tx
      .update(users)
      .set({ fullName: input.fullName, phone: input.phone, updatedAt: new Date() })
      .where(eq(users.id, ctx.userId));
    await audit(tx, ctx, { action: 'update', entityType: 'user', entityId: ctx.userId, changes });
  });
}
