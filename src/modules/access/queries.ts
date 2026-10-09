import 'server-only';

import { asc, eq } from 'drizzle-orm';

import { roles } from '@/db/schema';
import type { TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

/** The business's roles, for choosing what a new login can do. */
export async function listRoleOptions(ctx: TenantContext) {
  return withRls(ctx, (tx) =>
    tx
      .select({ id: roles.id, name: roles.name, key: roles.key })
      .from(roles)
      .where(eq(roles.tenantId, ctx.tenantId))
      .orderBy(asc(roles.name)),
  );
}
