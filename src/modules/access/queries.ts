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

/**
 * Roles a new hire's login can be given when they accept (ADR-048): every role but Admin, with
 * Staff first as the usual choice.
 */
export async function listHireLoginRoles(ctx: TenantContext) {
  const options = await listRoleOptions(ctx);
  const rank = (key: string) => (key === 'member' ? 0 : key === 'manager' ? 1 : 2);
  return options
    .filter((role) => role.key !== 'owner')
    .sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name))
    .map(({ id, name }) => ({ id, name }));
}
