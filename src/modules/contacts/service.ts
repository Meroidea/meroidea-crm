import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { contactOrganizations, contacts, organizations } from '@/db/schema';
import { diffChanges } from '@/lib/audit-diff';
import { AppError } from '@/lib/errors';
import { normalizeEmail, normalizePhone } from '@/lib/normalize';
import { assertCanAccess, scopeDecision } from '@/lib/permissions/scope';
import { audit } from '@/server/audit';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import { findDuplicateContacts } from './duplicates';
import type { CreateContactInput, DuplicateCheckInput, UpdateContactInput } from './schemas';
import type { DuplicateMatch } from './types';

const MATCH_WORDS: Record<DuplicateMatch['matchKind'], string> = {
  email: 'the same email',
  phone: 'the same phone number',
  name_dob: 'a similar name and the same date of birth',
};

/**
 * Who may own a record: yourself always; someone else (or nobody) only with contacts.assign,
 * and only a colleague inside that grant's scope.
 */
function assertCanAssign(ctx: TenantContext, ownerUserId: string | null): void {
  if (ownerUserId === ctx.userId) return;
  const decision = scopeDecision(ctx, 'contacts.assign');
  const allowed =
    decision.kind === 'all' ||
    (decision.kind === 'owners' && ownerUserId !== null && decision.userIds.includes(ownerUserId));
  if (!allowed) {
    throw new AppError('FORBIDDEN', 'You can’t assign records to that person.', {
      ownerUserId: ['Choose yourself or someone in your team'],
    });
  }
}

async function loadForWrite(tx: Tx, ctx: TenantContext, id: string) {
  const [row] = await tx
    .select()
    .from(contacts)
    .where(
      and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, id), isNull(contacts.deletedAt)),
    )
    .limit(1)
    .for('update');
  if (!row) throw new AppError('NOT_FOUND', 'That record was not found.');
  return row;
}

function normalizedFields(ctx: TenantContext, input: CreateContactInput | UpdateContactInput) {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    emailNormalized: normalizeEmail(input.email),
    phone: input.phone,
    phoneE164: normalizePhone(input.phone, ctx.tenant.country),
    altPhone: input.altPhone,
    gender: input.gender,
    addressLine: input.addressLine,
    city: input.city,
    region: input.region,
    country: input.country,
    status: input.status,
    sourceId: input.sourceId,
    marketingConsent: input.marketingConsent,
  };
}

export async function checkDuplicates(
  ctx: TenantContext,
  input: DuplicateCheckInput,
): Promise<DuplicateMatch[]> {
  requirePermission(ctx, 'contacts.create');
  return withRls(ctx, (tx) => findDuplicateContacts(tx, ctx, input));
}

export async function createContact(
  ctx: TenantContext,
  input: CreateContactInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'contacts.create');
  const ownerUserId = input.ownerUserId ?? ctx.userId;
  assertCanAssign(ctx, ownerUserId);
  const canViewSensitive = hasPermission(ctx, 'contacts.view_sensitive');

  return withRls(ctx, async (tx) => {
    const matches = await findDuplicateContacts(tx, ctx, input);
    const [first] = matches;
    if (first && !input.confirmDuplicate) {
      const owner = first.ownerName ? ` (owned by ${first.ownerName})` : ' (unassigned)';
      throw new AppError(
        'DUPLICATE',
        `A ${ctx.tenant.labels.contact.singular.toLowerCase()} with ${MATCH_WORDS[first.matchKind]} already exists${owner}.`,
      );
    }

    const now = new Date();
    const [created] = await tx
      .insert(contacts)
      .values({
        tenantId: ctx.tenantId,
        ...normalizedFields(ctx, input),
        dateOfBirth: canViewSensitive ? input.dateOfBirth : null,
        ownerUserId,
        consentUpdatedAt: input.marketingConsent ? now : null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: contacts.id });
    if (!created) throw new AppError('INTERNAL', 'Could not save the record.');

    await audit(tx, ctx, {
      action: 'create',
      entityType: 'contact',
      entityId: created.id,
      context: matches.length > 0 ? { duplicateWarningOverridden: matches.length } : null,
    });
    return created;
  });
}

export async function updateContact(
  ctx: TenantContext,
  input: UpdateContactInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'contacts.edit');
  const canViewSensitive = hasPermission(ctx, 'contacts.view_sensitive');

  return withRls(ctx, async (tx) => {
    const existing = await loadForWrite(tx, ctx, input.id);
    assertCanAccess(ctx, 'contacts.edit', existing);

    const ownerUserId = input.ownerUserId ?? existing.ownerUserId;
    const ownerChanged = ownerUserId !== existing.ownerUserId;
    if (ownerChanged) {
      requirePermission(ctx, 'contacts.assign');
      assertCanAccess(ctx, 'contacts.assign', existing);
      assertCanAssign(ctx, ownerUserId);
    }

    const next = {
      ...normalizedFields(ctx, input),
      // Without view_sensitive the form never saw the value, so it must not overwrite it.
      dateOfBirth: canViewSensitive ? input.dateOfBirth : existing.dateOfBirth,
      ownerUserId,
      consentUpdatedAt:
        input.marketingConsent !== existing.marketingConsent
          ? new Date()
          : existing.consentUpdatedAt,
    };
    const changes = diffChanges(existing, next, ['dateOfBirth', 'emailNormalized', 'phoneE164']);
    delete changes.emailNormalized;
    delete changes.phoneE164;
    delete changes.consentUpdatedAt;
    if (Object.keys(changes).length === 0) return { id: existing.id };

    await tx
      .update(contacts)
      .set({ ...next, updatedBy: ctx.userId })
      .where(and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, existing.id)));

    const { ownerUserId: ownerChange, ...fieldChanges } = changes;
    if (Object.keys(fieldChanges).length > 0) {
      await audit(tx, ctx, {
        action: 'update',
        entityType: 'contact',
        entityId: existing.id,
        changes: fieldChanges,
      });
    }
    if (ownerChange) {
      await audit(tx, ctx, {
        action: 'owner_change',
        entityType: 'contact',
        entityId: existing.id,
        changes: { ownerUserId: ownerChange },
      });
    }
    return { id: existing.id };
  });
}

export async function deleteContact(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'contacts.delete');
  return withRls(ctx, async (tx) => {
    const existing = await loadForWrite(tx, ctx, id);
    assertCanAccess(ctx, 'contacts.delete', existing);
    await tx
      .update(contacts)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, id)));
    await audit(tx, ctx, { action: 'delete', entityType: 'contact', entityId: id });
    return { id };
  });
}

export async function linkOrganization(
  ctx: TenantContext,
  input: { contactId: string; organizationId: string; relationship: string },
): Promise<{ linkId: string }> {
  requirePermission(ctx, 'contacts.edit');
  return withRls(ctx, async (tx) => {
    const contact = await loadForWrite(tx, ctx, input.contactId);
    assertCanAccess(ctx, 'contacts.edit', contact);

    const [organization] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(
        and(
          eq(organizations.tenantId, ctx.tenantId),
          eq(organizations.id, input.organizationId),
          isNull(organizations.deletedAt),
        ),
      )
      .limit(1);
    if (!organization) throw new AppError('NOT_FOUND', 'That organization was not found.');

    const [link] = await tx
      .insert(contactOrganizations)
      .values({
        tenantId: ctx.tenantId,
        contactId: contact.id,
        organizationId: organization.id,
        relationship: input.relationship,
      })
      .onConflictDoNothing()
      .returning({ id: contactOrganizations.id });
    if (!link) throw new AppError('CONFLICT', 'That link already exists.');

    await audit(tx, ctx, {
      action: 'update',
      entityType: 'contact',
      entityId: contact.id,
      context: { linkedOrganizationId: organization.id, relationship: input.relationship },
    });
    return { linkId: link.id };
  });
}

export async function unlinkOrganization(
  ctx: TenantContext,
  input: { contactId: string; linkId: string },
): Promise<{ linkId: string }> {
  requirePermission(ctx, 'contacts.edit');
  return withRls(ctx, async (tx) => {
    const contact = await loadForWrite(tx, ctx, input.contactId);
    assertCanAccess(ctx, 'contacts.edit', contact);

    const [removed] = await tx
      .delete(contactOrganizations)
      .where(
        and(
          eq(contactOrganizations.tenantId, ctx.tenantId),
          eq(contactOrganizations.contactId, contact.id),
          eq(contactOrganizations.id, input.linkId),
        ),
      )
      .returning({ organizationId: contactOrganizations.organizationId });
    if (!removed) throw new AppError('NOT_FOUND', 'That link was not found.');

    await audit(tx, ctx, {
      action: 'update',
      entityType: 'contact',
      entityId: contact.id,
      context: { unlinkedOrganizationId: removed.organizationId },
    });
    return { linkId: input.linkId };
  });
}
