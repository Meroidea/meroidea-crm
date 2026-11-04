import 'server-only';

import { sql } from 'drizzle-orm';

import { zonedToday } from '@/lib/dates';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { BillFilter } from './schemas';

export type BillStatus = 'open' | 'overdue' | 'paid' | 'void';

export type BillRow = {
  id: string;
  number: number;
  supplierName: string;
  supplierReference: string | null;
  date: string;
  dueDate: string;
  total: string;
  balance: string;
  status: BillStatus;
};

export type BillDetail = BillRow & {
  amountsAre: 'inclusive' | 'exclusive' | 'no_tax';
  subtotal: string;
  taxTotal: string;
  notes: string | null;
  createdAt: Date;
  lines: {
    accountId: string;
    accountCode: string;
    accountName: string;
    description: string | null;
    amount: string;
    taxCode: string | null;
    taxCodeId: string | null;
    taxAmount: string;
  }[];
  payments: {
    id: string;
    date: string;
    amount: string;
    paymentTotal: string;
    accountName: string;
    reference: string | null;
    otherBills: number;
    voided: boolean;
  }[];
  credits: {
    id: string;
    date: string;
    reason: string;
    supplierReference: string | null;
    total: string;
    taxTotal: string;
    voided: boolean;
  }[];
};

const statusSql = (today: string) => sql`
  case when b.voided_at is not null then 'void'
       when app.bill_balance(b.tenant_id, b.id) = 0 then 'paid'
       when b.due_date < ${today}::date then 'overdue'
       else 'open' end`;

const BILL_COLUMNS = (today: string) => sql`
  b.id, b.number, b.supplier_name as "supplierName", b.supplier_reference as "supplierReference",
  b.date::text as date, b.due_date::text as "dueDate", b.total::text as total,
  (case when b.voided_at is null then app.bill_balance(b.tenant_id, b.id) else 0 end)::text
    as balance,
  ${statusSql(today)} as status`;

/** Bills, most urgent first: by due date for what is still owed, newest first otherwise. */
export async function listBills(
  ctx: TenantContext,
  filters: { status?: BillFilter; q?: string } = {},
): Promise<BillRow[]> {
  requirePermission(ctx, 'books.view');
  const today = zonedToday(ctx.tenant.timezone);
  const status = filters.status ?? 'open';
  const search = filters.q ? `%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  return (await withRls(ctx, (tx) =>
    tx.execute(sql`
      select * from (
        select ${BILL_COLUMNS(today)}
        from ledger_bills b
        where b.tenant_id = ${ctx.tenantId}
          ${
            search
              ? sql`and (b.supplier_name ilike ${search} or b.supplier_reference ilike ${search})`
              : sql``
          }
      ) bills
      where ${
        status === 'all'
          ? sql`true`
          : status === 'open'
            ? sql`status in ('open', 'overdue')`
            : sql`status = ${status}`
      }
      order by case when status in ('open', 'overdue') then "dueDate" end, date desc, number desc
      limit 500`),
  )) as unknown as BillRow[];
}

/** What is owed to suppliers, and how much of it is past due. */
export async function billTotals(ctx: TenantContext): Promise<{ owed: string; overdue: string }> {
  requirePermission(ctx, 'books.view');
  const today = zonedToday(ctx.tenant.timezone);
  const [row] = (await withRls(ctx, (tx) =>
    tx.execute(sql`
      select coalesce(sum(app.bill_balance(tenant_id, id)), 0)::text as owed,
             coalesce(sum(app.bill_balance(tenant_id, id)) filter (where due_date < ${today}::date), 0)::text
               as overdue
      from ledger_bills where tenant_id = ${ctx.tenantId} and voided_at is null`),
  )) as unknown as { owed: string; overdue: string }[];
  return row ?? { owed: '0.00', overdue: '0.00' };
}

export async function getBill(ctx: TenantContext, id: string): Promise<BillDetail | null> {
  requirePermission(ctx, 'books.view');
  const today = zonedToday(ctx.tenant.timezone);
  return withRls(ctx, async (tx) => {
    const [bill] = (await tx.execute(sql`
      select ${BILL_COLUMNS(today)}, b.amounts_are as "amountsAre", b.subtotal::text as subtotal,
             b.tax_total::text as "taxTotal", b.notes, b.created_at as "createdAt"
      from ledger_bills b where b.tenant_id = ${ctx.tenantId} and b.id = ${id}`)) as unknown as Omit<
      BillDetail,
      'lines' | 'payments' | 'credits'
    >[];
    if (!bill) return null;
    const lines = (await tx.execute(sql`
      select l.account_id as "accountId", a.code as "accountCode", a.name as "accountName",
             l.description, l.amount::text as amount, t.name as "taxCode",
             l.tax_code_id as "taxCodeId", l.tax_amount::text as "taxAmount"
      from ledger_bill_lines l
      join ledger_accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      left join ledger_tax_codes t on t.tenant_id = l.tenant_id and t.id = l.tax_code_id
      where l.tenant_id = ${ctx.tenantId} and l.bill_id = ${id}
      order by l.position`)) as unknown as BillDetail['lines'];
    const payments = (await tx.execute(sql`
      select p.id, p.date::text as date, a.amount::text as amount, p.amount::text as "paymentTotal",
             acc.name as "accountName", p.reference, p.voided_at is not null as voided,
             (select count(*)::int from ledger_bill_payment_allocations o
              where o.tenant_id = p.tenant_id and o.payment_id = p.id and o.bill_id <> ${id})
               as "otherBills"
      from ledger_bill_payment_allocations a
      join ledger_bill_payments p on p.tenant_id = a.tenant_id and p.id = a.payment_id
      join ledger_accounts acc on acc.tenant_id = p.tenant_id and acc.id = p.account_id
      where a.tenant_id = ${ctx.tenantId} and a.bill_id = ${id}
      order by p.date, p.created_at`)) as unknown as BillDetail['payments'];
    const credits = (await tx.execute(sql`
      select id, date::text as date, reason, supplier_reference as "supplierReference",
             total::text as total, tax_total::text as "taxTotal", voided_at is not null as voided
      from ledger_bill_credits where tenant_id = ${ctx.tenantId} and bill_id = ${id}
      order by date, created_at`)) as unknown as BillDetail['credits'];
    return { ...bill, lines, payments, credits };
  });
}

/**
 * Smart defaults: for each supplier, the account and tax code on the first line of their latest
 * bill, so the next bill from them fills itself in.
 */
export async function supplierDefaults(
  ctx: TenantContext,
): Promise<{ supplierName: string; accountId: string; taxCodeId: string | null }[]> {
  requirePermission(ctx, 'books.view');
  return (await withRls(ctx, (tx) =>
    tx.execute(sql`
      select distinct on (lower(b.supplier_name))
             b.supplier_name as "supplierName", l.account_id as "accountId",
             l.tax_code_id as "taxCodeId"
      from ledger_bills b
      join ledger_bill_lines l on l.tenant_id = b.tenant_id and l.bill_id = b.id and l.position = 0
      where b.tenant_id = ${ctx.tenantId} and b.voided_at is null
      order by lower(b.supplier_name), b.date desc, b.number desc
      limit 300`),
  )) as unknown as { supplierName: string; accountId: string; taxCodeId: string | null }[];
}
