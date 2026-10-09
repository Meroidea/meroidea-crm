import 'server-only';

import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';

import { leaveRequests, leaveTypes, users } from '@/db/schema';
import { hasPermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { LeaveStatus } from './schemas';

export type LeaveTypeRow = { id: string; name: string; isPaid: boolean; isActive: boolean };

export type LeaveRequestRow = {
  id: string;
  userId: string;
  personName: string;
  leaveTypeName: string;
  isPaid: boolean;
  startsOn: string;
  endsOn: string;
  days: string;
  note: string | null;
  status: LeaveStatus;
  decisionNote: string | null;
  decidedAt: Date | null;
  createdAt: Date;
};

export async function listLeaveTypes(ctx: TenantContext): Promise<LeaveTypeRow[]> {
  return withRls(ctx, (tx) =>
    tx
      .select({
        id: leaveTypes.id,
        name: leaveTypes.name,
        isPaid: leaveTypes.isPaid,
        isActive: leaveTypes.isActive,
      })
      .from(leaveTypes)
      .where(eq(leaveTypes.tenantId, ctx.tenantId))
      .orderBy(asc(leaveTypes.name)),
  );
}

/**
 * Leave requests, newest first. `scope: 'mine'` is the signed-in person's own; `'everyone'`
 * needs timeoff.manage and falls back to their own without it (RLS enforces the same).
 */
export async function listLeaveRequests(
  ctx: TenantContext,
  options: { scope: 'mine' | 'everyone'; statuses?: LeaveStatus[]; from?: string },
): Promise<LeaveRequestRow[]> {
  const everyone = options.scope === 'everyone' && hasPermission(ctx, 'timeoff.manage');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        id: leaveRequests.id,
        userId: leaveRequests.userId,
        personName: users.fullName,
        leaveTypeName: leaveTypes.name,
        isPaid: leaveTypes.isPaid,
        startsOn: leaveRequests.startsOn,
        endsOn: leaveRequests.endsOn,
        days: leaveRequests.days,
        note: leaveRequests.note,
        status: leaveRequests.status,
        decisionNote: leaveRequests.decisionNote,
        decidedAt: leaveRequests.decidedAt,
        createdAt: leaveRequests.createdAt,
      })
      .from(leaveRequests)
      .innerJoin(
        leaveTypes,
        and(
          eq(leaveTypes.tenantId, leaveRequests.tenantId),
          eq(leaveTypes.id, leaveRequests.leaveTypeId),
        ),
      )
      .innerJoin(users, eq(users.id, leaveRequests.userId))
      .where(
        and(
          eq(leaveRequests.tenantId, ctx.tenantId),
          everyone ? undefined : eq(leaveRequests.userId, ctx.userId),
          options.statuses ? inArray(leaveRequests.status, options.statuses) : undefined,
          options.from ? gte(leaveRequests.endsOn, options.from) : undefined,
        ),
      )
      .orderBy(desc(leaveRequests.startsOn), desc(leaveRequests.createdAt))
      .limit(200),
  );
  return rows as LeaveRequestRow[];
}

/** Approved days the signed-in person has taken or booked in a calendar year, per leave type. */
export async function getMyLeaveTotals(
  ctx: TenantContext,
  year: number,
): Promise<{ leaveTypeId: string; name: string; days: string }[]> {
  return withRls(ctx, (tx) =>
    tx
      .select({
        leaveTypeId: leaveTypes.id,
        name: leaveTypes.name,
        days: sql<string>`coalesce(sum(${leaveRequests.days}) filter (
          where ${leaveRequests.status} = 'approved'
            and ${leaveRequests.userId} = ${ctx.userId}
            and extract(year from ${leaveRequests.startsOn}) = ${year}
        ), 0)::text`,
      })
      .from(leaveTypes)
      .leftJoin(
        leaveRequests,
        and(
          eq(leaveRequests.tenantId, leaveTypes.tenantId),
          eq(leaveRequests.leaveTypeId, leaveTypes.id),
        ),
      )
      .where(and(eq(leaveTypes.tenantId, ctx.tenantId), eq(leaveTypes.isActive, true)))
      .groupBy(leaveTypes.id, leaveTypes.name)
      .orderBy(asc(leaveTypes.name)),
  );
}
