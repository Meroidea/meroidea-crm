import 'server-only';

import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';

import { expenseClaims, users } from '@/db/schema';
import { decodeCursor, encodeCursor } from '@/lib/cursor';
import { hasPermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { ExpenseFilter, ExpenseStatus } from './schemas';

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
  createdAt: Date;
};

export const EXPENSE_PAGE_SIZE = 50;

const FILTER_STATUSES: Record<ExpenseFilter, ExpenseStatus[] | null> = {
  open: ['submitted', 'approved'],
  done: ['reimbursed', 'declined'],
  all: null,
};

/**
 * Newest first, a page at a time, so no claim is ever out of reach however many there are.
 * `'everyone'` needs expenses.manage and falls back to the person's own without it.
 */
export async function listExpenses(
  ctx: TenantContext,
  scope: 'mine' | 'everyone',
  options: { filter?: ExpenseFilter; cursor?: string } = {},
): Promise<{ items: ExpenseRow[]; nextCursor: string | null }> {
  const everyone = scope === 'everyone' && hasPermission(ctx, 'expenses.manage');
  const statuses = FILTER_STATUSES[options.filter ?? 'all'];
  const cursor = decodeCursor(options.cursor);
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        id: expenseClaims.id,
        userId: expenseClaims.userId,
        // Someone who has since left is no longer readable as a colleague; their claim stays.
        personName: sql<string>`coalesce(${users.fullName}, 'Former member')`,
        spentOn: expenseClaims.spentOn,
        category: expenseClaims.category,
        merchant: expenseClaims.merchant,
        description: expenseClaims.description,
        amount: expenseClaims.amount,
        currency: expenseClaims.currency,
        hasReceipt: sql<boolean>`${expenseClaims.receiptPath} is not null`,
        status: expenseClaims.status,
        decisionNote: expenseClaims.decisionNote,
        createdAt: expenseClaims.createdAt,
      })
      .from(expenseClaims)
      .leftJoin(users, eq(users.id, expenseClaims.userId))
      .where(
        and(
          eq(expenseClaims.tenantId, ctx.tenantId),
          isNull(expenseClaims.deletedAt),
          everyone ? undefined : eq(expenseClaims.userId, ctx.userId),
          statuses ? inArray(expenseClaims.status, statuses) : undefined,
          cursor
            ? (or(
                lt(expenseClaims.createdAt, cursor.createdAt),
                and(eq(expenseClaims.createdAt, cursor.createdAt), lt(expenseClaims.id, cursor.id)),
              ) as SQL)
            : undefined,
        ),
      )
      .orderBy(desc(expenseClaims.createdAt), desc(expenseClaims.id))
      .limit(EXPENSE_PAGE_SIZE + 1),
  );
  const items = rows.slice(0, EXPENSE_PAGE_SIZE);
  const last = items.at(-1);
  return {
    items: items as ExpenseRow[],
    nextCursor: rows.length > EXPENSE_PAGE_SIZE && last ? encodeCursor(last) : null,
  };
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
