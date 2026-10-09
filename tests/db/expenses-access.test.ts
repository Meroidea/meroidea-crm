import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { expenseClaims } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { getExpenseTotals, listExpenses } from '@/modules/expenses/queries';
import { matchesReceipt, receiptExtension } from '@/modules/expenses/receipts';
import { submitExpenseSchema } from '@/modules/expenses/schemas';
import {
  decideExpense,
  getReceiptUrl,
  markReimbursed,
  startReceiptUpload,
  submitExpense,
  withdrawExpense,
} from '@/modules/expenses/service';
import type { TenantContext } from '@/server/context';
import { adminDb } from '@/server/db/admin';
import { withRls } from '@/server/db/with-rls';
import { readObject, writeObject } from '@/server/storage';

import { addMember, contextFor, createWorkspace, destroyWorkspace } from '../support/workspaces';

const stamp = Date.now();
const mail = (name: string) => `${name}-${stamp}@example.com`;

let alphaTenant: string;
let betaTenant: string;
let alphaUsers: string[];
let betaUsers: string[];
let owner: TenantContext;
let manager: TenantContext;
let erin: TenantContext;
let flynn: TenantContext;
let betaOwner: TenantContext;
let claimId: string;

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (error: unknown) => (error instanceof AppError ? error.code : String(error)),
  );

const claim = (amount: string, extra = {}) =>
  submitExpenseSchema.parse({
    spentOn: '2031-02-03',
    category: 'Travel',
    merchant: 'Harbour Taxis',
    description: 'To the supplier',
    amount,
    ...extra,
  });

beforeAll(async () => {
  const alpha = await createWorkspace(`Spend Alpha ${stamp}`, mail('spend-alpha-owner'));
  const beta = await createWorkspace(`Spend Beta ${stamp}`, mail('spend-beta-owner'));
  alphaTenant = alpha.tenantId;
  betaTenant = beta.tenantId;
  const managerId = await addMember(alphaTenant, mail('spend-manager'), 'Mia Manager', 'manager');
  const erinId = await addMember(alphaTenant, mail('spend-erin'), 'Erin Expense', 'member');
  const flynnId = await addMember(alphaTenant, mail('spend-flynn'), 'Flynn Float', 'member');
  alphaUsers = [alpha.ownerId, managerId, erinId, flynnId];
  betaUsers = [beta.ownerId];
  owner = await contextFor(alpha.ownerId, alphaTenant);
  manager = await contextFor(managerId, alphaTenant);
  erin = await contextFor(erinId, alphaTenant);
  flynn = await contextFor(flynnId, alphaTenant);
  betaOwner = await contextFor(beta.ownerId, betaTenant);
}, 60_000);

afterAll(async () => {
  await destroyWorkspace(alphaTenant, alphaUsers);
  await destroyWorkspace(betaTenant, betaUsers);
});

describe('claiming an expense', () => {
  it('the form accepts its own output and refuses zero or badly written amounts', () => {
    const parsed = claim('42.5');
    expect(submitExpenseSchema.parse(parsed)).toEqual(parsed);
    for (const amount of ['0', '-5', '1.234', 'ten']) {
      expect(submitExpenseSchema.safeParse({ ...parsed, amount }).success).toBe(false);
    }
  });

  it("a claim is recorded in the business's currency, exactly", async () => {
    claimId = (await submitExpense(erin, claim('42.5'))).id;
    await submitExpense(erin, claim('0.10'));
    await submitExpense(erin, claim('0.20'));
    const totals = await getExpenseTotals(erin, 'mine');
    // 42.50 + 0.10 + 0.20, added by the database: no floating-point drift.
    expect(totals.submitted).toBe('42.80');
    expect(
      (await listExpenses(erin, 'mine')).every((row) => row.currency === owner.tenant.currency),
    ).toBe(true);
  });
});

describe('receipts', () => {
  const pdf = Buffer.from('%PDF-1.4 sample receipt');

  it('knows a photo or PDF from something pretending to be one', () => {
    expect(receiptExtension('lunch.JPG')).toBe('jpg');
    expect(receiptExtension('lunch.exe')).toBeNull();
    expect(matchesReceipt('pdf', pdf)).toBe(true);
    expect(matchesReceipt('png', pdf)).toBe(false);
  });

  it('refuses the wrong kind of file and one that is too big', async () => {
    expect(await code(startReceiptUpload(erin, { fileName: 'virus.exe', sizeBytes: 10 }))).toBe(
      'VALIDATION',
    );
    expect(
      await code(startReceiptUpload(erin, { fileName: 'big.pdf', sizeBytes: 11 * 1024 * 1024 })),
    ).toBe('VALIDATION');
  });

  it("refuses a receipt path that is not the person's own upload", async () => {
    const path = `${alphaTenant}/expenses/${flynn.userId}/someone-elses.pdf`;
    await writeObject(path, pdf, 'application/pdf');
    expect(await code(submitExpense(erin, claim('5', { receiptPath: path })))).toBe('VALIDATION');
    expect(
      await code(
        submitExpense(
          erin,
          claim('5', { receiptPath: `${betaTenant}/expenses/${erin.userId}/x.pdf` }),
        ),
      ),
    ).toBe('VALIDATION');
  });

  it('removes a file that is not what its name says', async () => {
    const path = `${alphaTenant}/expenses/${erin.userId}/fake-${stamp}.png`;
    await writeObject(path, pdf, 'image/png');
    expect(await code(submitExpense(erin, claim('5', { receiptPath: path })))).toBe('VALIDATION');
    expect(await readObject(path)).toBeNull();
  });

  it('a real receipt is attached, and only the person and managers can open it', async () => {
    const path = `${alphaTenant}/expenses/${erin.userId}/real-${stamp}.pdf`;
    await writeObject(path, pdf, 'application/pdf');
    const { id } = await submitExpense(
      erin,
      claim('18.00', { receiptPath: path, receiptName: 'taxi.pdf' }),
    );
    expect((await getReceiptUrl(erin, id)).url).toContain('token=');
    expect((await getReceiptUrl(manager, id)).url).toContain('token=');
    expect(await code(getReceiptUrl(flynn, id))).toBe('NOT_FOUND');
    expect(await code(getReceiptUrl(betaOwner, id))).toBe('NOT_FOUND');
    // Withdrawing removes the stored receipt too.
    await withdrawExpense(erin, id);
    expect(await readObject(path)).toBeNull();
  });
});

describe('who can see and decide', () => {
  it("a colleague and another business see none of a person's claims", async () => {
    expect(await listExpenses(flynn, 'everyone')).toEqual([]);
    expect(await listExpenses(betaOwner, 'everyone')).toEqual([]);
    expect(
      await code(decideExpense(betaOwner, { id: claimId, decision: 'approved', note: null })),
    ).toBe('NOT_FOUND');
    expect(await code(withdrawExpense(flynn, claimId))).toBe('NOT_FOUND');
  });

  it('a person cannot approve their own claim, even straight at the database', async () => {
    expect(await code(decideExpense(erin, { id: claimId, decision: 'approved', note: null }))).toBe(
      'FORBIDDEN',
    );
    await expect(
      withRls(erin, (tx) => tx.update(expenseClaims).set({ status: 'approved' })),
    ).rejects.toThrow();
  });

  it('a manager cannot approve their own claim; someone else must', async () => {
    const { id } = await submitExpense(manager, claim('9.99'));
    expect(await code(decideExpense(manager, { id, decision: 'approved', note: null }))).toBe(
      'CONFLICT',
    );
    expect(await code(decideExpense(owner, { id, decision: 'approved', note: null }))).toBe('OK');
  });

  it('approve, then pay back, in that order only', async () => {
    expect(await code(markReimbursed(manager, claimId))).toBe('CONFLICT');
    await decideExpense(manager, { id: claimId, decision: 'approved', note: 'Thanks' });
    expect(
      await code(decideExpense(manager, { id: claimId, decision: 'declined', note: null })),
    ).toBe('CONFLICT');
    expect(await code(withdrawExpense(erin, claimId))).toBe('CONFLICT');
    expect(await code(markReimbursed(erin, claimId))).toBe('FORBIDDEN');
    await markReimbursed(manager, claimId);
    const totals = await getExpenseTotals(erin, 'mine');
    expect([totals.reimbursed, totals.submitted]).toEqual(['42.50', '0.30']);
  });
});

describe('the feature switch', () => {
  it('switching expenses off stops new claims', async () => {
    await adminDb().execute(
      sql`update tenants set features = array_remove(features, 'expenses') where id = ${alphaTenant}`,
    );
    const ctx = await contextFor(erin.userId, alphaTenant);
    expect(await code(submitExpense(ctx, claim('1')))).toBe('FORBIDDEN');
  });
});
