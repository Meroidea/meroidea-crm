import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';

import { tenantMemberships, users } from '@/db/schema';
import type { TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

export type MemberOption = { userId: string; fullName: string };

/** Active colleagues, for owner pickers and filters. */
export async function listActiveMembers(ctx: TenantContext): Promise<MemberOption[]> {
  return withRls(ctx, (tx) =>
    tx
      .select({ userId: tenantMemberships.userId, fullName: users.fullName })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(
        and(eq(tenantMemberships.tenantId, ctx.tenantId), eq(tenantMemberships.status, 'active')),
      )
      .orderBy(asc(users.fullName)),
  );
}

export async function getMyName(ctx: TenantContext): Promise<string> {
  const [row] = await withRls(ctx, (tx) =>
    tx.select({ fullName: users.fullName }).from(users).where(eq(users.id, ctx.userId)).limit(1),
  );
  return row?.fullName ?? ctx.email;
}

/** Record counts for the new-workspace checklist. RLS keeps them to this tenant. */
export async function getWorkspaceCounts(ctx: TenantContext) {
  const rows = (await withRls(ctx, (tx) =>
    tx.execute(sql`
      select
        (select count(*)::int from contacts where tenant_id = ${ctx.tenantId} and deleted_at is null) as contacts,
        (select count(*)::int from opportunities where tenant_id = ${ctx.tenantId} and deleted_at is null) as opportunities,
        (select count(*)::int from tasks where tenant_id = ${ctx.tenantId} and deleted_at is null) as tasks,
        (select count(*)::int from tenant_memberships where tenant_id = ${ctx.tenantId} and status = 'active') as members`),
  )) as unknown as { contacts: number; opportunities: number; tasks: number; members: number }[];
  return rows[0] ?? { contacts: 0, opportunities: 0, tasks: 0, members: 1 };
}
