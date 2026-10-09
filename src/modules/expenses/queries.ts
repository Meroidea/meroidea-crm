import 'server-only';

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { expenseClaims, users } from '@/db/schema';
import { hasPermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { ExpenseStatus } from './schemas';

export type ExpenseRow = {
  id: string;
  userId: string;
  personName: string;
  spentOn: string;
  category: string;
  merchant: string | null;
  description: string | null;
  amount: string;
  currency: string;
  hasReceipt: boolean;
  status: ExpenseStatus;
  decisionNote: string | null;
};

/** `'everyone'` needs expenses.manage and falls back to the person's own without it. */
export async function listExpenses(
  ctx: TenantContext,
  scope: 'mine' | 'everyone',
): Promise<ExpenseRow[]> {
  const everyone = scope === 'everyone' && hasPermission(ctx, 'expenses.manage');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        id: expenseClaims.id,
        userId: expenseClaims.userId,
        personName: users.fullName,
        spentOn: expenseClaims.spentOn,
        category: expenseClaims.category,
        merchant: expenseClaims.merchant,
        description: expenseClaims.description,
        amount: expenseClaims.amount,
        currency: expenseClaims.currency,
        hasReceipt: sql<boolean>`${expenseClaims.receiptPath} is not null`,
        status: expenseClaims.status,
        decisionNote: expenseClaims.decisionNote,
      })
      .from(expenseClaims)
      .innerJoin(users, eq(users.id, expenseClaims.userId))
      .where(
        and(
          eq(expenseClaims.tenantId, ctx.tenantId),
          isNull(expenseClaims.deletedAt),
          everyone ? undefined : eq(expenseClaims.userId, ctx.userId),
        ),
      )
      .orderBy(desc(expenseClaims.spentOn), desc(expenseClaims.createdAt))
      .limit(300),
  );
  return rows as ExpenseRow[];
}

/** Totals by status, added up by the database. */
export async function getExpenseTotals(
  ctx: TenantContext,
  scope: 'mine' | 'everyone',
): Promise<Record<'submitted' | 'approved' | 'reimbursed', string>> {
  const everyone = scope === 'everyone' && hasPermission(ctx, 'expenses.manage');
  const total = (status: string) =>
    sql<string>`coalesce(sum(${expenseClaims.amount}) filter (where ${expenseClaims.status} = ${status}), 0)::text`;
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({
        submitted: total('submitted'),
        approved: total('approved'),
        reimbursed: total('reimbursed'),
      })
      .from(expenseClaims)
      .where(
        and(
          eq(expenseClaims.tenantId, ctx.tenantId),
          isNull(expenseClaims.deletedAt),
          everyone ? undefined : eq(expenseClaims.userId, ctx.userId),
        ),
      ),
  );
  return row ?? { submitted: '0', approved: '0', reimbursed: '0' };
}
