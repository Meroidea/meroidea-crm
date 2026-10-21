import 'server-only';

import { eq } from 'drizzle-orm';

import { users } from '@/db/schema';
import type { TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

export type MyProfile = {
  fullName: string;
  email: string;
  phone: string | null;
  roleName: string;
  businessName: string;
};

/** The signed-in person's own details; RLS returns only their row. */
export async function getMyProfile(ctx: TenantContext): Promise<MyProfile> {
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({ fullName: users.fullName, phone: users.phone })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1),
  );
  return {
    fullName: row?.fullName ?? ctx.email,
    email: ctx.email,
    phone: row?.phone ?? null,
    roleName: ctx.roleName,
    businessName: ctx.tenant.name,
  };
}
