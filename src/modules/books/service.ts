import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { ledgerAccounts, ledgerSettings, ledgerTaxCodes } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import { ledgerCall, toLedgerError } from './ledger-call';
import { countryPack } from './packs';
import {
  buildBankEntry,
  buildJournal,
  buildTransfer,
  PostingError,
  toDatabaseLines,
  type PostingLine,
} from './posting';
import type {
  BooksSettingsInput,
  ExportReportInput,
  JournalInput,
  MoneyInput,
  PayPayslipInput,
  SaveAccountInput,
  SaveTaxCodeInput,
  SetupBooksInput,
  TransferInput,
} from './schemas';

/** Postgres raises these as unique or check violations; say which field is wrong. */
function duplicateOr(error: unknown, field: string, message: string): unknown {
  const code = (error as { cause?: { code?: string } }).cause?.code;
  if (code === '23505') return new AppError('DUPLICATE', message, { [field]: [message] });
  return toLedgerError(error);
}

function postingFailed(error: unknown): never {
  if (error instanceof PostingError) throw new AppError('VALIDATION', error.message);
  throw error;
}

/**
 * Creates the chart of accounts, tax codes and settings from a country pack, then brings in the
 * invoices and released payslips dated from the start date, so the books begin complete.
 */
export async function setupBooks(
  ctx: TenantContext,
  input: SetupBooksInput,
): Promise<{ posted: number }> {
  requirePermission(ctx, 'books.manage');
  const pack = countryPack(input.country);
  if (!pack) throw new AppError('VALIDATION', 'That country is not available yet.');
  return withRls(ctx, async (tx) => {
    const [existing] = await tx
      .select({ tenantId: ledgerSettings.tenantId })
      .from(ledgerSettings)
      .where(eq(ledgerSettings.tenantId, ctx.tenantId))
      .limit(1);
    if (existing) throw new AppError('CONFLICT', 'The books are already set up.');

    const taxCodes = await tx
      .insert(ledgerTaxCodes)
      .values(
        pack.taxCodes.map((code) => ({
          tenantId: ctx.tenantId,
          code: code.code,
          name: code.name,
          rate: code.rate,
          kind: code.kind,
          appliesTo: code.appliesTo,
          systemKey: code.systemKey ?? null,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })),
      )
      .returning({ id: ledgerTaxCodes.id, code: ledgerTaxCodes.code });
    const taxId = new Map(taxCodes.map((code) => [code.code, code.id]));

    const accounts = await tx
      .insert(ledgerAccounts)
      .values(
        pack.accounts.map((account) => ({
          tenantId: ctx.tenantId,
          code: account.code,
          name: account.name,
          type: account.type,
          subtype: account.subtype,
          isBank: account.isBank ?? false,
          systemKey: account.systemKey ?? null,
          defaultTaxCodeId: taxId.get(account.tax) ?? null,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })),
      )
      .returning({ id: ledgerAccounts.id, systemKey: ledgerAccounts.systemKey });
    const accountFor = (key: string) => {
      const id = accounts.find((account) => account.systemKey === key)?.id;
      if (!id) throw new AppError('INTERNAL', `The ${pack.label} pack has no ${key} account.`);
      return id;
    };

    await tx.insert(ledgerSettings).values({
      tenantId: ctx.tenantId,
      countryPack: pack.country,
      financialYearStartMonth: input.financialYearStartMonth,
      startDate: input.startDate,
      receiptsAccountId: accountFor('bank'),
      invoiceIncomeAccountId: accountFor('sales'),
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });
    const [caughtUp] = await ledgerCall<{ posted: number }>(
      tx,
      sql`select app.ledger_catch_up() as posted`,
    );
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'books',
      entityId: null,
      context: {
        country: pack.country,
        startDate: input.startDate,
        accounts: accounts.length,
        taxCodes: taxCodes.length,
        posted: caughtUp?.posted ?? 0,
      },
    });
    return { posted: caughtUp?.posted ?? 0 };
  });
}

type AccountFacts = { id: string; isBank: boolean; archived: boolean; systemKey: string | null };

async function loadPostingFacts(tx: Tx, ctx: TenantContext) {
  const accounts = await tx
    .select({
      id: ledgerAccounts.id,
      isBank: ledgerAccounts.isBank,
      archivedAt: ledgerAccounts.archivedAt,
      systemKey: ledgerAccounts.systemKey,
    })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.tenantId, ctx.tenantId));
  if (accounts.length === 0) throw new AppError('CONFLICT', 'The books are not set up yet.');
  const taxCodes = await tx
    .select({ id: ledgerTaxCodes.id, rate: ledgerTaxCodes.rate })
    .from(ledgerTaxCodes)
    .where(eq(ledgerTaxCodes.tenantId, ctx.tenantId));
  const byId = new Map<string, AccountFacts>(
    accounts.map((account) => [
      account.id,
      {
        id: account.id,
        isBank: account.isBank,
        archived: account.archivedAt !== null,
        systemKey: account.systemKey,
      },
    ]),
  );
  const system = (key: string) => {
    const found = accounts.find((account) => account.systemKey === key);
    if (!found) throw new AppError('CONFLICT', `The chart of accounts has no ${key} account.`);
    return found.id;
  };
  return {
    account: (id: string) => byId.get(id),
    system,
    taxRates: new Map(taxCodes.map((code) => [code.id, code.rate])),
  };
}

async function postEntry(
  tx: Tx,
  ctx: TenantContext,
  entry: {
    kind: string;
    date: string;
    description: string;
    reference: string | null;
    contactName: string | null;
    isAdjustment: boolean;
    lines: PostingLine[];
  },
): Promise<{ id: string }> {
  const [row] = await ledgerCall<{ id: string }>(
    tx,
    sql`select app.ledger_post_entry(
      ${entry.kind}, ${entry.date}::date, ${entry.description}, ${entry.reference},
      ${entry.contactName}, ${entry.isAdjustment},
      ${JSON.stringify(toDatabaseLines(entry.lines))}::jsonb) as id`,
  );
  if (!row?.id) throw new AppError('INTERNAL', 'Could not save the entry.');
  await audit(tx, ctx, {
    action: 'create',
    entityType: 'ledger_entry',
    entityId: row.id,
    context: { kind: entry.kind, date: entry.date },
  });
  return { id: row.id };
}

/** Money received or spent that did not come from an invoice or a bill. */
export async function recordMoney(ctx: TenantContext, input: MoneyInput): Promise<{ id: string }> {
  requirePermission(ctx, 'books.record');
  requirePermission(ctx, 'books.view');
  return withRls(ctx, async (tx) => {
    const facts = await loadPostingFacts(tx, ctx);
    const bank = facts.account(input.bankAccountId);
    if (!bank || !bank.isBank || bank.archived) {
      throw new AppError('VALIDATION', 'Choose one of your bank accounts.', {
        bankAccountId: ['Choose one of your bank accounts'],
      });
    }
    let lines: PostingLine[];
    try {
      lines = buildBankEntry({
        direction: input.kind === 'money_in' ? 'in' : 'out',
        bankAccountId: input.bankAccountId,
        gstAccountId: facts.system('gst'),
        amountsAre: input.amountsAre,
        items: input.items,
        taxRates: facts.taxRates,
      });
    } catch (error) {
      postingFailed(error);
    }
    return postEntry(tx, ctx, {
      kind: input.kind,
      date: input.date,
      description: input.description,
      reference: input.reference,
      contactName: input.contactName,
      isAdjustment: false,
      lines,
    });
  });
}

export async function recordTransfer(
  ctx: TenantContext,
  input: TransferInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'books.record');
  requirePermission(ctx, 'books.view');
  return withRls(ctx, async (tx) => {
    const facts = await loadPostingFacts(tx, ctx);
    for (const id of [input.fromAccountId, input.toAccountId]) {
      const account = facts.account(id);
      if (!account || !account.isBank || account.archived) {
        throw new AppError('VALIDATION', 'A transfer moves money between your bank accounts.');
      }
    }
    let lines: PostingLine[];
    try {
      lines = buildTransfer(input);
    } catch (error) {
      postingFailed(error);
    }
    return postEntry(tx, ctx, {
      kind: 'transfer',
      date: input.date,
      description: input.description,
      reference: input.reference,
      contactName: null,
      isAdjustment: false,
      lines,
    });
  });
}

/** A journal (accountant level), or the opening balances when the books begin. */
export async function recordJournal(
  ctx: TenantContext,
  input: JournalInput,
): Promise<{ id: string }> {
  requirePermission(ctx, input.kind === 'opening_balance' ? 'books.manage' : 'books.journal');
  requirePermission(ctx, 'books.view');
  return withRls(ctx, async (tx) => {
    const facts = await loadPostingFacts(tx, ctx);
    let lines: PostingLine[];
    try {
      lines = buildJournal({
        lines: input.lines,
        balancingAccountId:
          input.kind === 'opening_balance' ? facts.system('opening_balances') : null,
      });
    } catch (error) {
      postingFailed(error);
    }
    return postEntry(tx, ctx, {
      kind: input.kind,
      date: input.date,
      description: input.description,
      reference: input.reference,
      contactName: null,
      isAdjustment: input.kind === 'journal' && input.isAdjustment,
      lines,
    });
  });
}

/** Voids an entry made in the books by posting its reversal; the original stays on record. */
export async function voidEntry(
  ctx: TenantContext,
  input: { id: string; reason: string | null },
): Promise<{ reversalId: string }> {
  requirePermission(ctx, 'books.view');
  return withRls(ctx, async (tx) => {
    const [row] = await ledgerCall<{ id: string }>(
      tx,
      sql`select app.ledger_void_entry(${input.id}::uuid, ${input.reason}) as id`,
    );
    if (!row?.id) throw new AppError('INTERNAL', 'Could not void the entry.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'ledger_entry',
      entityId: input.id,
      changes: { status: ['posted', 'voided'] },
      context: { reversalId: row.id },
    });
    return { reversalId: row.id };
  });
}

export async function saveAccount(
  ctx: TenantContext,
  input: SaveAccountInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'books.manage');
  return withRls(ctx, async (tx) => {
    const fields = {
      code: input.code,
      name: input.name,
      type: input.type,
      subtype: input.subtype,
      isBank: input.isBank,
      defaultTaxCodeId: input.defaultTaxCodeId,
      description: input.description,
      updatedBy: ctx.userId,
    };
    try {
      if (input.id) {
        const [before] = await tx
          .select({
            name: ledgerAccounts.name,
            code: ledgerAccounts.code,
            type: ledgerAccounts.type,
          })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.tenantId, ctx.tenantId), eq(ledgerAccounts.id, input.id)))
          .limit(1);
        if (!before) throw new AppError('NOT_FOUND', 'That account was not found.');
        await tx
          .update(ledgerAccounts)
          .set(fields)
          .where(and(eq(ledgerAccounts.tenantId, ctx.tenantId), eq(ledgerAccounts.id, input.id)));
        await audit(tx, ctx, {
          action: 'update',
          entityType: 'ledger_account',
          entityId: input.id,
          changes: {
            name: [before.name, input.name],
            code: [before.code, input.code],
            type: [before.type, input.type],
          },
        });
        return { id: input.id };
      }
      const [created] = await tx
        .insert(ledgerAccounts)
        .values({ ...fields, tenantId: ctx.tenantId, createdBy: ctx.userId })
        .returning({ id: ledgerAccounts.id });
      if (!created) throw new AppError('INTERNAL', 'Could not add the account.');
      await audit(tx, ctx, {
        action: 'create',
        entityType: 'ledger_account',
        entityId: created.id,
      });
      return created;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw duplicateOr(error, 'code', 'Another account already has that code.');
    }
  });
}

export async function setAccountArchived(
  ctx: TenantContext,
  input: { id: string; archived: boolean },
): Promise<{ id: string }> {
  requirePermission(ctx, 'books.manage');
  return withRls(ctx, async (tx) => {
    try {
      const updated = await tx
        .update(ledgerAccounts)
        .set({ archivedAt: input.archived ? new Date() : null, updatedBy: ctx.userId })
        .where(and(eq(ledgerAccounts.tenantId, ctx.tenantId), eq(ledgerAccounts.id, input.id)))
        .returning({ id: ledgerAccounts.id });
      if (updated.length === 0) throw new AppError('NOT_FOUND', 'That account was not found.');
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw toLedgerError(error);
    }
    await audit(tx, ctx, {
      action: input.archived ? 'delete' : 'restore',
      entityType: 'ledger_account',
      entityId: input.id,
    });
    return { id: input.id };
  });
}

export async function saveTaxCode(
  ctx: TenantContext,
  input: SaveTaxCodeInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'books.manage');
  return withRls(ctx, async (tx) => {
    const fields = {
      code: input.code,
      name: input.name,
      rate: input.rate,
      kind: input.kind,
      appliesTo: input.appliesTo,
      updatedBy: ctx.userId,
    };
    try {
      if (input.id) {
        const [before] = await tx
          .select({ rate: ledgerTaxCodes.rate, name: ledgerTaxCodes.name })
          .from(ledgerTaxCodes)
          .where(and(eq(ledgerTaxCodes.tenantId, ctx.tenantId), eq(ledgerTaxCodes.id, input.id)))
          .limit(1);
        if (!before) throw new AppError('NOT_FOUND', 'That tax code was not found.');
        await tx
          .update(ledgerTaxCodes)
          .set(fields)
          .where(and(eq(ledgerTaxCodes.tenantId, ctx.tenantId), eq(ledgerTaxCodes.id, input.id)));
        await audit(tx, ctx, {
          action: 'update',
          entityType: 'ledger_tax_code',
          entityId: input.id,
          changes: { rate: [before.rate, input.rate], name: [before.name, input.name] },
        });
        return { id: input.id };
      }
      const [created] = await tx
        .insert(ledgerTaxCodes)
        .values({ ...fields, tenantId: ctx.tenantId, createdBy: ctx.userId })
        .returning({ id: ledgerTaxCodes.id });
      if (!created) throw new AppError('INTERNAL', 'Could not add the tax code.');
      await audit(tx, ctx, {
        action: 'create',
        entityType: 'ledger_tax_code',
        entityId: created.id,
      });
      return created;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw duplicateOr(error, 'code', 'Another tax code already uses that code.');
    }
  });
}

/** Financial year, lock date and where invoices post. A lock date change is always audited. */
export async function saveBooksSettings(
  ctx: TenantContext,
  input: BooksSettingsInput,
): Promise<{ ok: true }> {
  requirePermission(ctx, 'books.manage');
  return withRls(ctx, async (tx) => {
    const [before] = await tx
      .select()
      .from(ledgerSettings)
      .where(eq(ledgerSettings.tenantId, ctx.tenantId))
      .limit(1);
    if (!before) throw new AppError('CONFLICT', 'The books are not set up yet.');
    try {
      await tx
        .update(ledgerSettings)
        .set({
          financialYearStartMonth: input.financialYearStartMonth,
          lockDate: input.lockDate,
          receiptsAccountId: input.receiptsAccountId,
          invoiceIncomeAccountId: input.invoiceIncomeAccountId,
          updatedBy: ctx.userId,
        })
        .where(eq(ledgerSettings.tenantId, ctx.tenantId));
    } catch (error) {
      throw toLedgerError(error);
    }
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'books',
      entityId: null,
      changes: {
        lockDate: [before.lockDate, input.lockDate],
        financialYearStartMonth: [before.financialYearStartMonth, input.financialYearStartMonth],
        receiptsAccountId: [before.receiptsAccountId, input.receiptsAccountId],
        invoiceIncomeAccountId: [before.invoiceIncomeAccountId, input.invoiceIncomeAccountId],
      },
    });
    return { ok: true };
  });
}

/** Brings in invoices and payslips posted while the books were switched off. Never twice. */
export async function catchUpBooks(ctx: TenantContext): Promise<{ posted: number }> {
  requirePermission(ctx, 'books.manage');
  return withRls(ctx, async (tx) => {
    const [row] = await ledgerCall<{ posted: number }>(
      tx,
      sql`select app.ledger_catch_up() as posted`,
    );
    const posted = row?.posted ?? 0;
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'books',
      entityId: null,
      context: { caughtUp: posted },
    });
    return { posted };
  });
}

/** Records net pay leaving the bank for a released payslip. */
export async function payPayslip(
  ctx: TenantContext,
  input: PayPayslipInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'books.record');
  requirePermission(ctx, 'books.view_payroll');
  return withRls(ctx, async (tx) => {
    const [row] = await ledgerCall<{ id: string }>(
      tx,
      sql`select app.ledger_pay_payslip(${input.payslipId}::uuid, ${input.bankAccountId}::uuid,
                                        ${input.date}::date) as id`,
    );
    if (!row?.id) throw new AppError('INTERNAL', 'Could not record the payment.');
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'ledger_entry',
      entityId: row.id,
      context: { kind: 'payslip_payment' },
    });
    return { id: row.id };
  });
}

/** Audits a report download before the file is made (rules/security.md: exports are audited). */
export async function recordBooksExport(
  ctx: TenantContext,
  input: ExportReportInput,
): Promise<{ ok: true }> {
  requirePermission(ctx, 'books.export');
  await withRls(ctx, (tx) =>
    audit(tx, ctx, {
      action: 'export',
      entityType: 'books_report',
      entityId: input.accountId ?? null,
      context: { report: input.report, from: input.from ?? null, to: input.to },
    }),
  );
  return { ok: true };
}
