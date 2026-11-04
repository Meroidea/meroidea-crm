import 'server-only';

import { sql } from 'drizzle-orm';

import { zonedToday } from '@/lib/dates';
import { hasFeature, hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { financialYearStart, formatCents, toCents } from './money';
import { SUBTYPE_LABELS, type AccountSubtype, type AccountType } from './packs';
import type { EntryKind } from './schemas';

export type BooksSettingsView = {
  countryPack: string;
  financialYearStartMonth: number;
  startDate: string;
  lockDate: string | null;
  receiptsAccountId: string;
  invoiceIncomeAccountId: string;
};

export type AccountRow = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype;
  isBank: boolean;
  systemKey: string | null;
  defaultTaxCodeId: string | null;
  description: string | null;
  archived: boolean;
  /** As at today, on the account's natural side: positive is normal. */
  balance: string;
};

export type TaxCodeRow = {
  id: string;
  code: string;
  name: string;
  rate: string;
  kind: string;
  appliesTo: string;
  systemKey: string | null;
  archived: boolean;
};

export type EntryRow = {
  id: string;
  number: number;
  date: string;
  kind: EntryKind;
  description: string;
  reference: string | null;
  contactName: string | null;
  isAdjustment: boolean;
  total: string;
  sourceType: string | null;
  sourceId: string | null;
  reversed: boolean;
  payroll: boolean;
};

export type EntryLine = {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  debit: string;
  credit: string;
  description: string | null;
  taxCode: string | null;
  taxAmount: string | null;
};

export type EntryDetail = EntryRow & {
  createdAt: Date;
  createdByName: string | null;
  lines: EntryLine[];
  reverses: { id: string; number: number } | null;
  reversedBy: { id: string; number: number } | null;
};

const today = (ctx: TenantContext) => zonedToday(ctx.tenant.timezone);

/** Asset and expense accounts grow with debits; the others with credits. */
const naturalSql = sql`case when a.type in ('asset', 'expense')
  then coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0)
  else coalesce(sum(l.credit), 0) - coalesce(sum(l.debit), 0) end`;

/** Whether this person's reports leave out wages, because they may not see pay. */
export function excludesPayroll(ctx: TenantContext): boolean {
  return !hasPermission(ctx, 'books.view_payroll');
}

export async function getBooksSettings(ctx: TenantContext): Promise<BooksSettingsView | null> {
  requirePermission(ctx, 'books.view');
  const rows = (await withRls(ctx, (tx) =>
    tx.execute(sql`
      select country_pack as "countryPack", financial_year_start_month as "financialYearStartMonth",
             start_date::text as "startDate", lock_date::text as "lockDate",
             receipts_account_id as "receiptsAccountId",
             invoice_income_account_id as "invoiceIncomeAccountId"
      from ledger_settings where tenant_id = ${ctx.tenantId}`),
  )) as unknown as BooksSettingsView[];
  return rows[0] ?? null;
}

export async function listAccounts(
  ctx: TenantContext,
  options: { includeArchived?: boolean } = {},
): Promise<AccountRow[]> {
  requirePermission(ctx, 'books.view');
  const asAt = today(ctx);
  return (await withRls(ctx, (tx) =>
    tx.execute(sql`
      select a.id, a.code, a.name, a.type, a.subtype, a.is_bank as "isBank",
             a.system_key as "systemKey", a.default_tax_code_id as "defaultTaxCodeId",
             a.description, a.archived_at is not null as archived,
             (${naturalSql})::text as balance
      from ledger_accounts a
      left join ledger_lines l
        on l.tenant_id = a.tenant_id and l.account_id = a.id and l.date <= ${asAt}::date
      where a.tenant_id = ${ctx.tenantId}
        ${options.includeArchived ? sql`` : sql`and a.archived_at is null`}
      group by a.id
      order by a.code`),
  )) as unknown as AccountRow[];
}

export async function listTaxCodes(
  ctx: TenantContext,
  options: { includeArchived?: boolean } = {},
): Promise<TaxCodeRow[]> {
  requirePermission(ctx, 'books.view');
  return (await withRls(ctx, (tx) =>
    tx.execute(sql`
      select id, code, name, rate::text as rate, kind, applies_to as "appliesTo",
             system_key as "systemKey", archived_at is not null as archived
      from ledger_tax_codes
      where tenant_id = ${ctx.tenantId}
        ${options.includeArchived ? sql`` : sql`and archived_at is null`}
      order by code`),
  )) as unknown as TaxCodeRow[];
}

const ENTRY_COLUMNS = sql`
  e.id, e.number, e.date::text as date, e.kind, e.description, e.reference,
  e.contact_name as "contactName", e.is_adjustment as "isAdjustment",
  (select coalesce(sum(x.debit), 0) from ledger_lines x
   where x.tenant_id = e.tenant_id and x.entry_id = e.id)::text as total,
  e.source_type as "sourceType", e.source_id as "sourceId",
  e.reversed_by_entry_id is not null as reversed, e.payroll`;

export const ENTRIES_PAGE_SIZE = 50;

export async function listEntries(
  ctx: TenantContext,
  filters: { kind?: EntryKind; q?: string; from?: string; to?: string; cursor?: string } = {},
): Promise<{ items: EntryRow[]; nextCursor: string | null }> {
  requirePermission(ctx, 'books.view');
  const [cursorDate, cursorNumber] = filters.cursor?.split('_') ?? [];
  const search = filters.q ? `%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const rows = (await withRls(ctx, (tx) =>
    tx.execute(sql`
      select ${ENTRY_COLUMNS}
      from ledger_entries e
      where e.tenant_id = ${ctx.tenantId}
        ${filters.kind ? sql`and e.kind = ${filters.kind}` : sql``}
        ${filters.from ? sql`and e.date >= ${filters.from}::date` : sql``}
        ${filters.to ? sql`and e.date <= ${filters.to}::date` : sql``}
        ${
          search
            ? sql`and (e.description ilike ${search} or e.reference ilike ${search}
                       or e.contact_name ilike ${search})`
            : sql``
        }
        ${
          cursorDate && cursorNumber
            ? sql`and (e.date, e.number) < (${cursorDate}::date, ${Number(cursorNumber)})`
            : sql``
        }
      order by e.date desc, e.number desc
      limit ${ENTRIES_PAGE_SIZE + 1}`),
  )) as unknown as EntryRow[];
  const items = rows.slice(0, ENTRIES_PAGE_SIZE);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > ENTRIES_PAGE_SIZE && last ? `${last.date}_${last.number}` : null,
  };
}

export async function getEntry(ctx: TenantContext, id: string): Promise<EntryDetail | null> {
  requirePermission(ctx, 'books.view');
  return withRls(ctx, async (tx) => {
    const [entry] = (await tx.execute(sql`
      select ${ENTRY_COLUMNS}, e.created_at as "createdAt", u.full_name as "createdByName",
             e.reverses_entry_id as "reversesId", r.number as "reversesNumber",
             e.reversed_by_entry_id as "reversedById", rb.number as "reversedByNumber"
      from ledger_entries e
      left join users u on u.id = e.created_by
      left join ledger_entries r on r.tenant_id = e.tenant_id and r.id = e.reverses_entry_id
      left join ledger_entries rb on rb.tenant_id = e.tenant_id and rb.id = e.reversed_by_entry_id
      where e.tenant_id = ${ctx.tenantId} and e.id = ${id}`)) as unknown as (EntryRow & {
      createdAt: Date;
      createdByName: string | null;
      reversesId: string | null;
      reversesNumber: number | null;
      reversedById: string | null;
      reversedByNumber: number | null;
    })[];
    if (!entry) return null;
    const lines = (await tx.execute(sql`
      select l.account_id as "accountId", a.code as "accountCode", a.name as "accountName",
             a.type as "accountType", l.debit::text as debit, l.credit::text as credit,
             l.description, t.name as "taxCode", l.tax_amount::text as "taxAmount"
      from ledger_lines l
      join ledger_accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      left join ledger_tax_codes t on t.tenant_id = l.tenant_id and t.id = l.tax_code_id
      where l.tenant_id = ${ctx.tenantId} and l.entry_id = ${id}
      order by l.position`)) as unknown as EntryLine[];
    const { reversesId, reversesNumber, reversedById, reversedByNumber, ...rest } = entry;
    return {
      ...rest,
      lines,
      reverses: reversesId && reversesNumber ? { id: reversesId, number: reversesNumber } : null,
      reversedBy:
        reversedById && reversedByNumber ? { id: reversedById, number: reversedByNumber } : null,
    };
  });
}

/**
 * The entries a document created: the "view entries" behind an invoice (with its payments and
 * credit notes, ADR-061) or a payslip.
 */
export async function entriesForSource(
  ctx: TenantContext,
  sourceType: 'invoice' | 'payslip' | 'bill',
  sourceId: string,
): Promise<EntryRow[]> {
  requirePermission(ctx, 'books.view');
  return (await withRls(ctx, (tx) =>
    tx.execute(sql`
      select ${ENTRY_COLUMNS}
      from ledger_entries e
      where e.tenant_id = ${ctx.tenantId}
        and (
          (e.source_type = ${sourceType} and e.source_id = ${sourceId})
          ${
            sourceType === 'invoice'
              ? sql`or (e.source_type = 'invoice_payment' and e.source_id in (
                      select a.payment_id from invoice_payment_allocations a
                      where a.tenant_id = e.tenant_id and a.invoice_id = ${sourceId}))
                    or (e.source_type = 'credit_note' and e.source_id in (
                      select c.id from invoice_credit_notes c
                      where c.tenant_id = e.tenant_id and c.invoice_id = ${sourceId}))`
              : sourceType === 'bill'
                ? sql`or (e.source_type = 'bill_payment' and e.source_id in (
                        select a.payment_id from ledger_bill_payment_allocations a
                        where a.tenant_id = e.tenant_id and a.bill_id = ${sourceId}))
                      or (e.source_type = 'bill_credit' and e.source_id in (
                        select c.id from ledger_bill_credits c
                        where c.tenant_id = e.tenant_id and c.bill_id = ${sourceId}))`
                : sql``
          }
        )
      order by e.date, e.number`),
  )) as unknown as EntryRow[];
}

type Balance = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype;
  systemKey: string | null;
  debit: string;
  credit: string;
  amount: string;
};

async function balancesBetween(
  ctx: TenantContext,
  from: string | null,
  to: string,
): Promise<Balance[]> {
  return (await withRls(ctx, (tx) =>
    tx.execute(sql`
      select a.id as "accountId", a.code, a.name, a.type, a.subtype, a.system_key as "systemKey",
             coalesce(sum(l.debit), 0)::text as debit, coalesce(sum(l.credit), 0)::text as credit,
             (${naturalSql})::text as amount
      from ledger_accounts a
      left join ledger_lines l
        on l.tenant_id = a.tenant_id and l.account_id = a.id
       and l.date <= ${to}::date
       ${from ? sql`and l.date >= ${from}::date` : sql``}
      where a.tenant_id = ${ctx.tenantId}
      group by a.id
      order by a.code`),
  )) as unknown as Balance[];
}

/** Income less expenses, as cents, over the balances given. */
function profitOf(balances: Balance[]): bigint {
  return balances.reduce((total, row) => {
    if (row.type === 'income') return total + toCents(row.amount);
    if (row.type === 'expense') return total - toCents(row.amount);
    return total;
  }, 0n);
}

const dayBefore = (date: string) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
};

async function yearStartMonth(ctx: TenantContext): Promise<number> {
  const settings = await getBooksSettings(ctx);
  return settings?.financialYearStartMonth ?? 7;
}

export type TrialBalanceRow = {
  accountId: string | null;
  code: string;
  name: string;
  type: AccountType;
  debit: string;
  credit: string;
};

/**
 * Every account with a balance on its debit or credit side. Income and expenses count from the
 * start of the financial year; earlier years' profit sits in retained earnings, as it would after
 * a year-end close, without anyone having to post one.
 */
export async function trialBalance(
  ctx: TenantContext,
  asAt: string,
): Promise<{ asAt: string; rows: TrialBalanceRow[]; totalDebit: string; totalCredit: string }> {
  requirePermission(ctx, 'books.view');
  const yearStart = financialYearStart(asAt, await yearStartMonth(ctx));
  const [cumulative, thisYear] = await Promise.all([
    balancesBetween(ctx, null, asAt),
    balancesBetween(ctx, yearStart, asAt),
  ]);
  const priorProfit = profitOf(cumulative) - profitOf(thisYear);
  const rows: TrialBalanceRow[] = [];
  let debits = 0n;
  let credits = 0n;
  for (const row of cumulative) {
    const source =
      row.type === 'income' || row.type === 'expense'
        ? thisYear.find((other) => other.accountId === row.accountId)
        : row;
    let net = toCents(source?.debit) - toCents(source?.credit);
    // Earlier years' profit is a credit to retained earnings.
    if (row.systemKey === 'retained_earnings') net -= priorProfit;
    if (net === 0n) continue;
    rows.push({
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      type: row.type,
      debit: net > 0n ? formatCents(net) : '0.00',
      credit: net < 0n ? formatCents(-net) : '0.00',
    });
    if (net > 0n) debits += net;
    else credits -= net;
  }
  return { asAt, rows, totalDebit: formatCents(debits), totalCredit: formatCents(credits) };
}

export type ReportLine = {
  accountId: string;
  code: string;
  name: string;
  amount: string;
  compare: string | null;
};
export type ReportSection = {
  key: AccountSubtype | 'earnings';
  label: string;
  lines: ReportLine[];
  total: string;
  compare: string | null;
};

function section(
  key: AccountSubtype,
  rows: Balance[],
  compareRows: Balance[] | null,
): ReportSection {
  const lines: ReportLine[] = [];
  for (const row of rows.filter((candidate) => candidate.subtype === key)) {
    const other = compareRows?.find((candidate) => candidate.accountId === row.accountId);
    if (toCents(row.amount) === 0n && toCents(other?.amount) === 0n) continue;
    lines.push({
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      amount: formatCents(toCents(row.amount)),
      compare: compareRows ? formatCents(toCents(other?.amount)) : null,
    });
  }
  return {
    key,
    label: SUBTYPE_LABELS[key],
    lines,
    total: formatCents(lines.reduce((sum, line) => sum + toCents(line.amount), 0n)),
    compare: compareRows
      ? formatCents(lines.reduce((sum, line) => sum + toCents(line.compare), 0n))
      : null,
  };
}

export type ProfitAndLoss = {
  from: string;
  to: string;
  compareFrom: string | null;
  compareTo: string | null;
  income: ReportSection[];
  costOfSales: ReportSection;
  expenses: ReportSection[];
  grossProfit: { amount: string; compare: string | null };
  netProfit: { amount: string; compare: string | null };
};

/** Income, cost of sales, expenses and the profit left, for a period and, if asked, the one before. */
export async function profitAndLoss(
  ctx: TenantContext,
  from: string,
  to: string,
  compare: 'none' | 'previous' = 'none',
): Promise<ProfitAndLoss> {
  requirePermission(ctx, 'books.view');
  let compareFrom: string | null = null;
  let compareTo: string | null = null;
  if (compare === 'previous') {
    const days = Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
    );
    compareTo = dayBefore(from);
    const start = new Date(`${compareTo}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - days);
    compareFrom = start.toISOString().slice(0, 10);
  }
  const [rows, compareRows] = await Promise.all([
    balancesBetween(ctx, from, to),
    compareFrom && compareTo ? balancesBetween(ctx, compareFrom, compareTo) : null,
  ]);
  const income = [
    section('revenue', rows, compareRows),
    section('other_income', rows, compareRows),
  ];
  const costOfSales = section('cost_of_sales', rows, compareRows);
  const expenses = [
    section('expense', rows, compareRows),
    section('other_expense', rows, compareRows),
  ];
  const trading = toCents(income[0]?.total) - toCents(costOfSales.total);
  const tradingCompare = compareRows
    ? toCents(income[0]?.compare) - toCents(costOfSales.compare)
    : null;
  const net =
    trading +
    toCents(income[1]?.total) -
    expenses.reduce((sum, part) => sum + toCents(part.total), 0n);
  const netCompare =
    tradingCompare === null
      ? null
      : tradingCompare +
        toCents(income[1]?.compare) -
        expenses.reduce((sum, part) => sum + toCents(part.compare), 0n);
  return {
    from,
    to,
    compareFrom,
    compareTo,
    income,
    costOfSales,
    expenses,
    grossProfit: {
      amount: formatCents(trading),
      compare: tradingCompare === null ? null : formatCents(tradingCompare),
    },
    netProfit: {
      amount: formatCents(net),
      compare: netCompare === null ? null : formatCents(netCompare),
    },
  };
}

export type BalanceSheet = {
  asAt: string;
  assets: ReportSection[];
  liabilities: ReportSection[];
  equity: ReportSection;
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  netAssets: string;
  balanced: boolean;
};

/**
 * What the business owns and owes on a day. Equity shows this year's profit so far as "Current
 * year earnings" and adds earlier years' profit to retained earnings, so the sheet balances
 * without a year-end entry.
 */
export async function balanceSheet(ctx: TenantContext, asAt: string): Promise<BalanceSheet> {
  requirePermission(ctx, 'books.view');
  const yearStart = financialYearStart(asAt, await yearStartMonth(ctx));
  const [cumulative, thisYear] = await Promise.all([
    balancesBetween(ctx, null, asAt),
    balancesBetween(ctx, yearStart, asAt),
  ]);
  const currentYear = profitOf(thisYear);
  const priorYears = profitOf(cumulative) - currentYear;

  const assets = (['bank', 'current_asset', 'fixed_asset', 'non_current_asset'] as const).map(
    (key) => section(key, cumulative, null),
  );
  const liabilities = (['current_liability', 'non_current_liability'] as const).map((key) =>
    section(key, cumulative, null),
  );
  const equityRows = cumulative.map((row) =>
    row.systemKey === 'retained_earnings'
      ? { ...row, amount: formatCents(toCents(row.amount) + priorYears) }
      : row,
  );
  const equity = section('equity', equityRows, null);
  equity.lines.push({
    accountId: '',
    code: '',
    name: 'Current year earnings',
    amount: formatCents(currentYear),
    compare: null,
  });
  equity.total = formatCents(toCents(equity.total) + currentYear);

  const totalAssets = assets.reduce((sum, part) => sum + toCents(part.total), 0n);
  const totalLiabilities = liabilities.reduce((sum, part) => sum + toCents(part.total), 0n);
  const totalEquity = toCents(equity.total);
  return {
    asAt,
    assets,
    liabilities,
    equity,
    totalAssets: formatCents(totalAssets),
    totalLiabilities: formatCents(totalLiabilities),
    totalEquity: formatCents(totalEquity),
    netAssets: formatCents(totalAssets - totalLiabilities),
    balanced: totalAssets - totalLiabilities === totalEquity,
  };
}

export type AccountLedgerRow = {
  entryId: string;
  number: number;
  date: string;
  kind: EntryKind;
  description: string;
  reference: string | null;
  lineDescription: string | null;
  debit: string;
  credit: string;
  balance: string;
};

export type AccountLedger = {
  account: AccountRow;
  from: string;
  to: string;
  opening: string;
  rows: AccountLedgerRow[];
  closing: string;
  truncated: boolean;
};

const LEDGER_ROW_LIMIT = 1000;

/** One account's transactions with a running balance: the general ledger, account by account. */
export async function accountLedger(
  ctx: TenantContext,
  accountId: string,
  from: string,
  to: string,
): Promise<AccountLedger | null> {
  requirePermission(ctx, 'books.view');
  const accounts = await listAccounts(ctx, { includeArchived: true });
  const account = accounts.find((candidate) => candidate.id === accountId);
  if (!account) return null;
  const debitNormal = account.type === 'asset' || account.type === 'expense';
  // Income and expenses start each financial year at nothing.
  const openingFrom =
    account.type === 'income' || account.type === 'expense'
      ? financialYearStart(from, await yearStartMonth(ctx))
      : null;
  return withRls(ctx, async (tx) => {
    const [opening] = (await tx.execute(sql`
      select coalesce(sum(debit), 0)::text as debit, coalesce(sum(credit), 0)::text as credit
      from ledger_lines
      where tenant_id = ${ctx.tenantId} and account_id = ${accountId} and date < ${from}::date
        ${openingFrom ? sql`and date >= ${openingFrom}::date` : sql``}`)) as unknown as {
      debit: string;
      credit: string;
    }[];
    const lines = (await tx.execute(sql`
      select e.id as "entryId", e.number, e.date::text as date, e.kind, e.description,
             e.reference, l.description as "lineDescription", l.debit::text as debit,
             l.credit::text as credit
      from ledger_lines l
      join ledger_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
      where l.tenant_id = ${ctx.tenantId} and l.account_id = ${accountId}
        and l.date between ${from}::date and ${to}::date
      order by l.date, e.number, l.position
      limit ${LEDGER_ROW_LIMIT + 1}`)) as unknown as Omit<AccountLedgerRow, 'balance'>[];
    const signed = (debit: string | undefined, credit: string | undefined) =>
      debitNormal ? toCents(debit) - toCents(credit) : toCents(credit) - toCents(debit);
    let running = signed(opening?.debit, opening?.credit);
    const openingCents = running;
    const rows = lines.slice(0, LEDGER_ROW_LIMIT).map((line) => {
      running += signed(line.debit, line.credit);
      return { ...line, balance: formatCents(running) };
    });
    return {
      account,
      from,
      to,
      opening: formatCents(openingCents),
      rows,
      closing: formatCents(running),
      truncated: lines.length > LEDGER_ROW_LIMIT,
    };
  });
}

export type UnpaidPayslip = {
  payslipId: string;
  date: string;
  employeeName: string | null;
  net: string;
};

/** Net pay posted from released payslips but not yet recorded as paid from the bank. */
export async function unpaidPayslips(ctx: TenantContext): Promise<UnpaidPayslip[]> {
  requirePermission(ctx, 'books.view');
  if (!hasPermission(ctx, 'books.view_payroll')) return [];
  return (await withRls(ctx, (tx) =>
    tx.execute(sql`
      select e.source_id as "payslipId", e.date::text as date, e.contact_name as "employeeName",
             coalesce(sum(l.credit) filter (where a.system_key = 'wages_payable'), 0)::text as net
      from ledger_entries e
      join ledger_lines l on l.tenant_id = e.tenant_id and l.entry_id = e.id
      join ledger_accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where e.tenant_id = ${ctx.tenantId} and e.source_type = 'payslip'
        and e.source_event = 'released' and e.reversed_by_entry_id is null
        and not exists (
          select 1 from ledger_entries paid
          where paid.tenant_id = e.tenant_id and paid.source_type = 'payslip'
            and paid.source_id = e.source_id and paid.source_event = 'paid')
      group by e.id
      having coalesce(sum(l.credit) filter (where a.system_key = 'wages_payable'), 0) > 0
      order by e.date
      limit 100`),
  )) as unknown as UnpaidPayslip[];
}

export type BooksOverview = {
  today: string;
  yearStart: string;
  banks: { id: string; code: string; name: string; balance: string }[];
  receivable: string;
  payable: string;
  gst: string;
  payrollOwed: string;
  profitThisYear: string;
  entries: number;
};

/** The owner's first look: cash in each bank, what is owed both ways, and profit this year. */
export async function booksOverview(ctx: TenantContext): Promise<BooksOverview> {
  requirePermission(ctx, 'books.view');
  const asAt = today(ctx);
  const yearStart = financialYearStart(asAt, await yearStartMonth(ctx));
  const [accounts, thisYear, counted] = await Promise.all([
    listAccounts(ctx),
    balancesBetween(ctx, yearStart, asAt),
    withRls(ctx, (tx) =>
      tx.execute(sql`select count(*)::int as n from ledger_entries
                     where tenant_id = ${ctx.tenantId}`),
    ) as unknown as Promise<{ n: number }[]>,
  ]);
  const bySystem = (key: string) =>
    accounts.find((account) => account.systemKey === key)?.balance ?? '0.00';
  return {
    today: asAt,
    yearStart,
    banks: accounts
      .filter((account) => account.isBank)
      .map(({ id, code, name, balance }) => ({ id, code, name, balance })),
    receivable: bySystem('accounts_receivable'),
    payable: bySystem('accounts_payable'),
    gst: bySystem('gst'),
    payrollOwed: formatCents(
      ['wages_payable', 'payg_withholding', 'super_payable'].reduce(
        (sum, key) => sum + toCents(bySystem(key)),
        0n,
      ),
    ),
    profitThisYear: formatCents(profitOf(thisYear)),
    entries: counted[0]?.n ?? 0,
  };
}

/**
 * The books' bank accounts as choices for another module's form (an invoice payment), or null
 * when the books are off, not set up, or not this person's to see.
 */
export async function listBankOptions(
  ctx: TenantContext,
): Promise<{ id: string; label: string }[] | null> {
  if (!hasFeature(ctx, 'books') || !hasPermission(ctx, 'books.view')) return null;
  if (!(await getBooksSettings(ctx))) return null;
  return (await listAccounts(ctx))
    .filter((account) => account.isBank)
    .map((account) => ({ id: account.id, label: `${account.code} · ${account.name}` }));
}
