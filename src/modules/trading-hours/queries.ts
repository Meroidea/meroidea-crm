import 'server-only';

import { asc, eq } from 'drizzle-orm';

import { tradingHours } from '@/db/schema';
import type { TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { TradingDay } from './types';

/**
 * The days the business has set, in weekday order; empty until someone sets them. Anyone in the
 * business may read them: opening hours are no secret to staff (ADR-076).
 */
export async function getTradingHours(ctx: TenantContext): Promise<TradingDay[]> {
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        weekday: tradingHours.weekday,
        opensAt: tradingHours.opensAt,
        closesAt: tradingHours.closesAt,
        staffNeeded: tradingHours.staffNeeded,
      })
      .from(tradingHours)
      .where(eq(tradingHours.tenantId, ctx.tenantId))
      .orderBy(asc(tradingHours.weekday)),
  );
  // Postgres returns "09:00:00"; the app speaks "09:00".
  return rows.map((row) => ({
    weekday: row.weekday,
    opensAt: row.opensAt?.slice(0, 5) ?? null,
    closesAt: row.closesAt?.slice(0, 5) ?? null,
    staffNeeded: row.staffNeeded,
  }));
}
