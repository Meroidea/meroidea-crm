import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { organizations, partners } from '@/db/schema';
import { diffChanges } from '@/lib/audit-diff';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { CreatePartnerInput, UpdatePartnerInput } from './schemas';

export async function createPartner(
  ctx: TenantContext,
  input: CreatePartnerInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'partners.manage');
  return withRls(ctx, async (tx) => {
    let organizationId = input.organizationId;
    if (organizationId) {
      const [org] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(
          and(
            eq(organizations.tenantId, ctx.tenantId),
            eq(organizations.id, organizationId),
            isNull(organizations.deletedAt),
          ),
        )
        .limit(1);
      if (!org) throw new AppError('NOT_FOUND', 'That organization was not found.');
    } else {
      const [org] = await tx
        .insert(organizations)
        .values({
          tenantId: ctx.tenantId,
          name: input.organizationName ?? '',
          type: 'partner',
          ownerUserId: ctx.userId,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: organizations.id });
      if (!org) throw new AppError('INTERNAL', 'Could not save the organization.');
      organizationId = org.id;
      await audit(tx, ctx, { action: 'create', entityType: 'organization', entityId: org.id });
    }

    const [created] = await tx
      .insert(partners)
      .values({
        tenantId: ctx.tenantId,
        organizationId,
        status: input.status,
        commissionType: input.commissionType,
        commissionValue: input.commissionType === 'none' ? null : input.commissionValue,
        currency: input.commissionType === 'fixed' ? ctx.tenant.currency : null,
        notes: input.notes,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .onConflictDoNothing()
      .returning({ id: partners.id });
    if (!created) throw new AppError('CONFLICT', 'That organization is already a partner.');
    await audit(tx, ctx, { action: 'create', entityType: 'partner', entityId: created.id });
    return created;
  });
}

export async function updatePartner(
  ctx: TenantContext,
  input: UpdatePartnerInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'partners.manage');
  return withRls(ctx, async (tx) => {
    const [existing] = await tx
      .select()
      .from(partners)
      .where(
        and(
          eq(partners.tenantId, ctx.tenantId),
          eq(partners.id, input.id),
          isNull(partners.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    if (!existing) throw new AppError('NOT_FOUND', 'That partner was not found.');
    const next = {
      status: input.status,
      commissionType: input.commissionType,
      commissionValue: input.commissionType === 'none' ? null : input.commissionValue,
      notes: input.notes,
    };
    const changes = diffChanges(existing, next);
    if (Object.keys(changes).length === 0) return { id: input.id };
    await tx
      .update(partners)
      .set({ ...next, updatedBy: ctx.userId })
      .where(and(eq(partners.tenantId, ctx.tenantId), eq(partners.id, input.id)));
    await audit(tx, ctx, { action: 'update', entityType: 'partner', entityId: input.id, changes });
    return { id: input.id };
  });
}
