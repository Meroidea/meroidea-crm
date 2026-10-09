import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { organizations } from '@/db/schema';
import { diffChanges } from '@/lib/audit-diff';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import type { OrganizationInput, UpdateOrganizationInput } from './schemas';

async function loadForWrite(tx: Tx, ctx: TenantContext, id: string) {
  const [row] = await tx
    .select()
    .from(organizations)
    .where(
      and(
        eq(organizations.tenantId, ctx.tenantId),
        eq(organizations.id, id),
        isNull(organizations.deletedAt),
      ),
    )
    .limit(1)
    .for('update');
  if (!row) throw new AppError('NOT_FOUND', 'That record was not found.');
  return row;
}

export async function createOrganization(
  ctx: TenantContext,
  input: OrganizationInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'organizations.manage');
  return withRls(ctx, async (tx) => {
    const [created] = await tx
      .insert(organizations)
      .values({
        tenantId: ctx.tenantId,
        ...input,
        ownerUserId: ctx.userId,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: organizations.id });
    if (!created) throw new AppError('INTERNAL', 'Could not save the record.');
    await audit(tx, ctx, { action: 'create', entityType: 'organization', entityId: created.id });
    return created;
  });
}

export async function updateOrganization(
  ctx: TenantContext,
  input: UpdateOrganizationInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'organizations.manage');
  return withRls(ctx, async (tx) => {
    const { id, ...fields } = input;
    const existing = await loadForWrite(tx, ctx, id);
    const changes = diffChanges(existing, fields);
    if (Object.keys(changes).length === 0) return { id };

    await tx
      .update(organizations)
      .set({ ...fields, updatedBy: ctx.userId })
      .where(and(eq(organizations.tenantId, ctx.tenantId), eq(organizations.id, id)));
    await audit(tx, ctx, { action: 'update', entityType: 'organization', entityId: id, changes });
    return { id };
  });
}

export async function deleteOrganization(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'organizations.manage');
  return withRls(ctx, async (tx) => {
    await loadForWrite(tx, ctx, id);
    await tx
      .update(organizations)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(organizations.tenantId, ctx.tenantId), eq(organizations.id, id)));
    await audit(tx, ctx, { action: 'delete', entityType: 'organization', entityId: id });
    return { id };
  });
}
