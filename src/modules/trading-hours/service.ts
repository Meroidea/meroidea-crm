import 'server-only';

import { sql } from 'drizzle-orm';

import { tradingHours } from '@/db/schema';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import type { SaveTradingHoursInput } from './schemas';
import type { TradingDay } from './types';

/**
 * Writes the whole week in one statement, one row per weekday. Used inside the caller's own
 * transaction: the admin's save below, and the platform owner's onboarding of a new business
 * (src/modules/platform/service.ts), which writes before any membership exists.
 */
export async function writeTradingWeek(
  tx: Tx,
  tenantId: string,
  days: TradingDay[],
  actorUserId: string,
): Promise<void> {
  await tx
    .insert(tradingHours)
    .values(
      days.map((day) => ({
        tenantId,
        weekday: day.weekday,
        opensAt: day.opensAt,
        closesAt: day.closesAt,
        staffNeeded: day.staffNeeded,
        updatedBy: actorUserId,
      })),
    )
    .onConflictDoUpdate({
      target: [tradingHours.tenantId, tradingHours.weekday],
      set: {
        opensAt: sql`excluded.opens_at`,
        closesAt: sql`excluded.closes_at`,
        staffNeeded: sql`excluded.staff_needed`,
        updatedBy: sql`excluded.updated_by`,
        updatedAt: sql`now()`,
      },
    });
}

/** The business's admin changes the trading hours (settings.manage). */
export async function saveTradingHours(
  ctx: TenantContext,
  input: SaveTradingHoursInput,
): Promise<{ openDays: number }> {
  requirePermission(ctx, 'settings.manage');
  const openDays = input.days.filter((day) => day.opensAt !== null).length;
  await withRls(ctx, async (tx) => {
    await writeTradingWeek(tx, ctx.tenantId, input.days, ctx.userId);
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'trading_hours',
      entityId: null,
      context: { openDays },
    });
  });
  return { openDays };
}
