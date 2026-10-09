import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import { expenseClaims } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';
import { createDownloadUrl, createUploadTicket, readObject, removeObject } from '@/server/storage';

import { matchesReceipt, MAX_RECEIPT_BYTES, receiptExtension } from './receipts';
import type { DecideExpenseInput, SubmitExpenseInput } from './schemas';

const receiptPrefix = (ctx: TenantContext) => `${ctx.tenantId}/expenses/${ctx.userId}/`;

/** Step one of attaching a receipt: a ticket to upload it straight to private storage. */
export async function startReceiptUpload(
  ctx: TenantContext,
  input: { fileName: string; sizeBytes: number },
): Promise<{ path: string; token: string }> {
  requirePermission(ctx, 'expenses.submit');
  const extension = receiptExtension(input.fileName);
  if (!extension) {
    throw new AppError('VALIDATION', 'A receipt must be a photo (JPG, PNG, WebP) or a PDF.');
  }
  if (input.sizeBytes > MAX_RECEIPT_BYTES) {
    throw new AppError('VALIDATION', 'Receipts can be up to 10 MB.');
  }
  return createUploadTicket(`${receiptPrefix(ctx)}${randomUUID()}.${extension}`);
}

/** Confirms an uploaded receipt is the person's own upload and really is a photo or PDF. */
async function verifiedReceipt(ctx: TenantContext, path: string, name: string | null) {
  const extension = receiptExtension(path);
  // The path came back from the browser, so it is checked rather than trusted.
  if (!extension || !path.startsWith(receiptPrefix(ctx)) || path.includes('..')) {
    throw new AppError('VALIDATION', 'That receipt could not be matched to an upload.');
  }
  const bytes = await readObject(path);
  if (!bytes) throw new AppError('NOT_FOUND', 'The receipt did not arrive. Try again.');
  if (bytes.length === 0 || bytes.length > MAX_RECEIPT_BYTES || !matchesReceipt(extension, bytes)) {
    await removeObject(path);
    throw new AppError('VALIDATION', 'That file is not a valid photo or PDF.', {
      receiptPath: ['Attach a JPG, PNG, WebP or PDF up to 10 MB'],
    });
  }
  return { receiptPath: path, receiptName: name ?? `receipt.${extension}` };
}

async function findClaim(tx: Tx, ctx: TenantContext, id: string) {
  const [claim] = await tx
    .select()
    .from(expenseClaims)
    .where(
      and(
        eq(expenseClaims.tenantId, ctx.tenantId),
        eq(expenseClaims.id, id),
        isNull(expenseClaims.deletedAt),
      ),
    )
    .limit(1);
  if (!claim) throw new AppError('NOT_FOUND', 'That expense was not found.');
  return claim;
}

export async function submitExpense(
  ctx: TenantContext,
  input: SubmitExpenseInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'expenses.submit');
  const receipt = input.receiptPath
    ? await verifiedReceipt(ctx, input.receiptPath, input.receiptName)
    : { receiptPath: null, receiptName: null };
  return withRls(ctx, async (tx) => {
    const [created] = await tx
      .insert(expenseClaims)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        spentOn: input.spentOn,
        category: input.category,
        merchant: input.merchant,
        description: input.description,
        amount: input.amount,
        currency: ctx.tenant.currency,
        ...receipt,
        status: 'submitted',
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: expenseClaims.id });
    if (!created) throw new AppError('INTERNAL', 'The expense could not be saved.');
    await audit(tx, ctx, { action: 'create', entityType: 'expense_claim', entityId: created.id });
    return created;
  });
}

/** Approves or declines a waiting claim. Nobody decides their own. */
export async function decideExpense(
  ctx: TenantContext,
  input: DecideExpenseInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'expenses.manage');
  return withRls(ctx, async (tx) => {
    const claim = await findClaim(tx, ctx, input.id);
    if (claim.status !== 'submitted') {
      throw new AppError('CONFLICT', 'That expense has already been dealt with.');
    }
    if (claim.userId === ctx.userId && ctx.roleKey !== 'owner') {
      throw new AppError('CONFLICT', 'Someone else has to approve your own expense.');
    }
    await tx
      .update(expenseClaims)
      .set({
        status: input.decision,
        decidedBy: ctx.userId,
        decidedAt: new Date(),
        decisionNote: input.note,
        updatedBy: ctx.userId,
      })
      .where(and(eq(expenseClaims.tenantId, ctx.tenantId), eq(expenseClaims.id, claim.id)));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'expense_claim',
      entityId: claim.id,
      changes: { status: ['submitted', input.decision] },
    });
    return { id: claim.id };
  });
}

/** Records that an approved claim has been paid back to the person. */
export async function markReimbursed(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'expenses.manage');
  return withRls(ctx, async (tx) => {
    const claim = await findClaim(tx, ctx, id);
    if (claim.status !== 'approved') {
      throw new AppError('CONFLICT', 'Only an approved expense can be marked as paid back.');
    }
    await tx
      .update(expenseClaims)
      .set({ status: 'reimbursed', reimbursedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(expenseClaims.tenantId, ctx.tenantId), eq(expenseClaims.id, claim.id)));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'expense_claim',
      entityId: claim.id,
      changes: { status: ['approved', 'reimbursed'] },
    });
    return { id: claim.id };
  });
}

/** A person takes back their own claim while it is still waiting. */
export async function withdrawExpense(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'expenses.submit');
  const claim = await withRls(ctx, async (tx) => {
    const found = await findClaim(tx, ctx, id);
    if (found.userId !== ctx.userId || found.status !== 'submitted') {
      throw new AppError('CONFLICT', 'Only your own waiting expenses can be withdrawn.');
    }
    await tx
      .update(expenseClaims)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(expenseClaims.tenantId, ctx.tenantId), eq(expenseClaims.id, found.id)));
    await audit(tx, ctx, { action: 'delete', entityType: 'expense_claim', entityId: found.id });
    return found;
  });
  if (claim.receiptPath) await removeObject(claim.receiptPath);
  return { id: claim.id };
}

/** A one-minute link to a claim's receipt, for the person or whoever manages expenses. Audited. */
export async function getReceiptUrl(ctx: TenantContext, id: string): Promise<{ url: string }> {
  if (!hasPermission(ctx, 'expenses.manage')) requirePermission(ctx, 'expenses.submit');
  const claim = await withRls(ctx, async (tx) => {
    const found = await findClaim(tx, ctx, id);
    if (!found.receiptPath) throw new AppError('NOT_FOUND', 'That expense has no receipt.');
    await audit(tx, ctx, { action: 'download', entityType: 'expense_claim', entityId: found.id });
    return found;
  });
  return {
    url: await createDownloadUrl(claim.receiptPath as string, claim.receiptName ?? 'receipt'),
  };
}
