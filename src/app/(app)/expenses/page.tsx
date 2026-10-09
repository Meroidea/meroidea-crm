import { Receipt } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { zonedToday } from '@/lib/dates';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ExpenseActions, NewExpenseButton } from '@/modules/expenses/components/expense-tools';
import { getExpenseTotals, listExpenses } from '@/modules/expenses/queries';
import { EXPENSE_STATUS_LABELS, expenseParamsSchema } from '@/modules/expenses/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Expenses' };

const STATUS_VARIANT = {
  submitted: 'outline',
  approved: 'secondary',
  declined: 'destructive',
  reimbursed: 'default',
} as const;

export default async function ExpensesPage({ searchParams }: PageProps<'/expenses'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'expenses.submit');
  const canManage = hasPermission(ctx, 'expenses.manage');
  const view = canManage ? (expenseParamsSchema.parse(await searchParams).view ?? 'mine') : 'mine';
  const scope = view === 'team' ? 'everyone' : 'mine';
  const [expenses, totals] = await Promise.all([
    listExpenses(ctx, scope),
    getExpenseTotals(ctx, scope),
  ]);
  const currency = ctx.tenant.currency;

  const tiles = [
    ['Waiting for approval', totals.submitted],
    ['Approved, to be paid', totals.approved],
    ['Paid back', totals.reimbursed],
  ] as const;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <PageHeader
        title="Expenses"
        description="Claim back what you paid for the business, with the receipt attached."
        actions={<NewExpenseButton today={zonedToday(ctx.tenant.timezone)} currency={currency} />}
      />

      {canManage && (
        <nav aria-label="Expense views" className="flex gap-1 border-b">
          {[
            ['mine', 'My expenses', '/expenses'],
            ['team', 'Everyone', '/expenses?view=team'],
          ].map(([key, label, href]) => (
            <Link
              key={key}
              href={href ?? '/expenses'}
              aria-current={view === key ? 'page' : undefined}
              className={cn(
                '-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground',
                view === key && 'border-primary font-medium text-foreground',
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tiles.map(([label, amount]) => (
          <div key={label} className="rounded-xl border bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
              {formatMoney(amount, currency)}
            </dd>
          </div>
        ))}
      </dl>

      {expenses.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={Receipt}
            title="No expenses yet"
            description="Add one with its receipt and it appears here with the manager's answer."
          />
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {expenses.map((expense) => (
            <li key={expense.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {view === 'team' && <span data-sensitive>{expense.personName} · </span>}
                  {expense.category}
                  {expense.merchant && (
                    <span className="font-normal text-muted-foreground"> · {expense.merchant}</span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatCalendarDate(expense.spentOn)}
                  {expense.description && ` · ${expense.description}`}
                </p>
                {expense.decisionNote && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Manager: {expense.decisionNote}
                  </p>
                )}
              </div>
              <p className="text-sm font-semibold tabular-nums">
                {formatMoney(expense.amount, expense.currency)}
              </p>
              <Badge variant={STATUS_VARIANT[expense.status]}>
                {EXPENSE_STATUS_LABELS[expense.status]}
              </Badge>
              <ExpenseActions
                id={expense.id}
                hasReceipt={expense.hasReceipt}
                canDecide={
                  canManage &&
                  expense.status === 'submitted' &&
                  (expense.userId !== ctx.userId || ctx.roleKey === 'owner')
                }
                canPay={canManage && expense.status === 'approved'}
                canWithdraw={expense.userId === ctx.userId && expense.status === 'submitted'}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
