import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { leadSources } from '@/db/schema';
import type { TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

export type LeadSourceOption = { id: string; name: string; type: string };

export async function listActiveLeadSources(ctx: TenantContext): Promise<LeadSourceOption[]> {
  return withRls(ctx, (tx) =>
    tx
      .select({ id: leadSources.id, name: leadSources.name, type: leadSources.type })
      .from(leadSources)
      .where(and(eq(leadSources.tenantId, ctx.tenantId), eq(leadSources.isActive, true)))
      .orderBy(asc(leadSources.position), asc(leadSources.name)),
  );
}
