import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { contactOrganizations, contacts, organizations } from '@/db/schema';
import { diffChanges } from '@/lib/audit-diff';
import { AppError } from '@/lib/errors';
import { normalizeEmail, normalizePhone } from '@/lib/normalize';
import { assertCanAccess } from '@/lib/permissions/scope';
import { recordSystemActivity } from '@/modules/activities/service';
import { loadCustomFields } from '@/modules/custom-fields/queries';
import { cleanCustomFields } from '@/modules/custom-fields/validation';
import { loadLeadConfig, systemStatus, validateSource } from '@/modules/leads/config';
import { routeLead } from '@/modules/leads/routing';
import { allowedLeadTypes } from '@/modules/leads/settings';
import { deliverEmails, notify, type PendingEmail } from '@/modules/notifications/service';
import { audit } from '@/server/audit';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import { assertCanAssignContact, contactRecord } from './access';
import { findDuplicateContacts } from './duplicates';
import type { CreateContactInput, DuplicateCheckInput, UpdateContactInput } from './schemas';
import type { DuplicateMatch } from './types';

const MATCH_WORDS: Record<DuplicateMatch['matchKind'], string> = {
  email: 'the same email',
  phone: 'the same phone number',
  name_dob: 'a similar name and the same date of birth',
  company_name: 'a similar name at the same company',
};

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
    subSourceId: input.subSourceId,
    campaignName: input.campaignName,
    jobTitle: input.jobTitle,
    companyName: input.companyName,
    companyWebsite: input.companyWebsite,
    companySize: input.companySize,
    industry: input.industry,
    linkedinUrl: input.linkedinUrl,
    language: input.language,
    interest: input.interest,
    doNotEmail: input.doNotEmail,
    doNotCall: input.doNotCall,
    consentSource: input.consentSource,
    marketingConsent: input.marketingConsent,
  };
}

async function validatedCustomFields(
  tx: Tx,
  ctx: TenantContext,
  submitted: Record<string, unknown>,
  existing: Record<string, unknown> = {},
) {
  const definitions = await loadCustomFields(tx, ctx.tenantId, 'contact');
  const custom = cleanCustomFields(definitions, submitted, existing);
  if (Object.keys(custom.errors).length > 0) {
    throw new AppError('VALIDATION', 'Check the highlighted fields.', custom.errors);
  }
  return custom.values;
}

export async function checkDuplicates(
  ctx: TenantContext,
  input: DuplicateCheckInput,
): Promise<DuplicateMatch[]> {
  requirePermission(ctx, 'contacts.create');
  return withRls(ctx, (tx) => findDuplicateContacts(tx, ctx, input));
}

/**
 * Adds a person. As a lead (docs/leads.md §3) they need a source (and its sub-source when it has
 * any), start in the New status, and go to the owner chosen on the form, to whoever the routing
 * rules pick, or to the unassigned queue. Duplicates warn first; the person can then open the
 * existing record, fold these details into it ("merge"), or create anyway.
 */
export async function createContact(
  ctx: TenantContext,
  input: CreateContactInput,
): Promise<{ id: string; merged?: boolean }> {
  requirePermission(ctx, 'contacts.create');
  const canViewSensitive = hasPermission(ctx, 'contacts.view_sensitive');

  const outcome = await withRls(ctx, async (tx) => {
    const config = await loadLeadConfig(tx, ctx);
    validateSource(config, input.sourceId, input.subSourceId, { required: input.isLead });
    const customFields = await validatedCustomFields(tx, ctx, input.customFields);

    if (input.mergeIntoId) {
      const merged = await mergeDetailsInto(tx, ctx, input.mergeIntoId, input, customFields);
      return { id: merged, merged: true, emails: [] as PendingEmail[] };
    }

    let leadType: 'b2b' | 'b2c' | null = null;
    if (input.isLead) {
      const allowed = allowedLeadTypes(config.settings);
      leadType = input.leadType ?? (allowed.length === 1 ? (allowed[0] ?? null) : null);
      if (!leadType || !allowed.includes(leadType)) {
        throw new AppError('VALIDATION', 'Choose whether this is a business or an individual.', {
          leadType: ['Choose B2B or B2C'],
        });
      }
    }

    const matches = await findDuplicateContacts(tx, ctx, input);
    const [first] = matches;
    if (first && !input.confirmDuplicate) {
      const owner = first.ownerName ? ` (owned by ${first.ownerName})` : ' (unassigned)';
      throw new AppError(
        'DUPLICATE',
        `A ${ctx.tenant.labels.contact.singular.toLowerCase()} with ${MATCH_WORDS[first.matchKind]} already exists${owner}.`,
      );
    }

    let ownerUserId: string | null;
    let routed = false;
    if (input.assignment === 'queue') {
      requirePermission(ctx, 'contacts.assign');
      assertCanAssignContact(ctx, null);
      ownerUserId = null;
    } else if (input.assignment === 'auto' && input.isLead) {
      const chosen = await routeLead(
        tx,
        ctx.tenantId,
        {
          leadType,
          sourceId: input.sourceId,
          subSourceId: input.subSourceId,
          country: input.country,
          region: input.region,
          industry: input.industry,
          companySize: input.companySize,
          language: input.language,
          interest: input.interest,
        },
        'intake',
      );
      // With no matching rule, the lead stays with the person adding it.
      ownerUserId = chosen ?? ctx.userId;
      routed = chosen !== null;
    } else {
      ownerUserId = input.ownerUserId ?? ctx.userId;
      assertCanAssignContact(ctx, ownerUserId);
    }

    const now = new Date();
    const status = input.isLead ? systemStatus(config, 'new', leadType) : null;
    const [created] = await tx
      .insert(contacts)
      .values({
        tenantId: ctx.tenantId,
        ...normalizedFields(ctx, input),
        dateOfBirth: canViewSensitive ? input.dateOfBirth : null,
        ownerUserId,
        customFields,
        consentUpdatedAt: input.marketingConsent ? now : null,
        leadType,
        leadStatusId: status?.id ?? null,
        leadStatusChangedAt: status ? now : null,
        assignedAt: ownerUserId ? now : null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: contacts.id });
    if (!created) throw new AppError('INTERNAL', 'Could not save the record.');

    if (input.isLead) {
      const source = config.sources.find((candidate) => candidate.id === input.sourceId);
      const sub = source?.subSources.find((candidate) => candidate.id === input.subSourceId);
      await recordSystemActivity(tx, ctx, {
        type: 'created',
        subject: `Lead added${source ? ` from ${source.name}${sub ? ` – ${sub.name}` : ''}` : ''}`,
        contactId: created.id,
        metadata: { routed, campaignName: input.campaignName },
      });
    }
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'contact',
      entityId: created.id,
      context: {
        ...(matches.length > 0 ? { duplicateWarningOverridden: matches.length } : {}),
        ...(input.isLead ? { lead: true, routed } : {}),
      },
    });
    const emails =
      ownerUserId && input.isLead
        ? await notify(tx, ctx, [
            {
              userId: ownerUserId,
              type: 'lead_assigned',
              title: `New lead: ${[input.firstName, input.lastName].filter(Boolean).join(' ')}`,
              url: `/contacts/${created.id}`,
              email: true,
            },
          ])
        : [];
    return { id: created.id, emails };
  });
  await deliverEmails(ctx, outcome.emails);
  return outcome.merged ? { id: outcome.id, merged: true } : { id: outcome.id };
}

/**
 * The "merge" answer to a duplicate warning: details from the form fill the gaps in the existing
 * record (nothing there is overwritten), and the timeline notes it.
 */
async function mergeDetailsInto(
  tx: Tx,
  ctx: TenantContext,
  targetId: string,
  input: CreateContactInput,
  customFields: Record<string, unknown>,
): Promise<string> {
  requirePermission(ctx, 'contacts.edit');
  const existing = await loadForWrite(tx, ctx, targetId);
  assertCanAccess(ctx, 'contacts.edit', contactRecord(existing));
  const incoming = normalizedFields(ctx, input);
  const fill: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    const current = existing[key as keyof typeof existing];
    if ((current === null || current === '') && value !== null && value !== '') fill[key] = value;
  }
  const mergedCustom = { ...customFields, ...(existing.customFields as Record<string, unknown>) };
  if (Object.keys(customFields).some((key) => !(key in (existing.customFields as object)))) {
    fill.customFields = mergedCustom;
  }
  if (Object.keys(fill).length > 0) {
    await tx
      .update(contacts)
      .set({ ...fill, updatedBy: ctx.userId })
      .where(and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, existing.id)));
  }
  await recordSystemActivity(tx, ctx, {
    type: 'merged',
    subject: 'New details merged into this record',
    contactId: existing.id,
    metadata: { filled: Object.keys(fill) },
  });
  await audit(tx, ctx, {
    action: 'update',
    entityType: 'contact',
    entityId: existing.id,
    context: { mergedFromForm: Object.keys(fill) },
  });
  return existing.id;
}

export async function updateContact(
  ctx: TenantContext,
  input: UpdateContactInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'contacts.edit');
  const canViewSensitive = hasPermission(ctx, 'contacts.view_sensitive');

  const outcome = await withRls(ctx, async (tx) => {
    const existing = await loadForWrite(tx, ctx, input.id);
    assertCanAccess(ctx, 'contacts.edit', contactRecord(existing));
    const config = await loadLeadConfig(tx, ctx);
    const isLead = existing.leadStatusId !== null;
    validateSource(config, input.sourceId, input.subSourceId, {
      required: isLead,
      previous: { sourceId: existing.sourceId, subSourceId: existing.subSourceId },
    });
    let leadType = existing.leadType;
    if (isLead && input.leadType && input.leadType !== existing.leadType) {
      const status = config.statuses.find((candidate) => candidate.id === existing.leadStatusId);
      if (status?.kind === 'converted' || status?.kind === 'pending_acceptance') {
        throw new AppError('CONFLICT', 'The lead type can’t change once it has been handed over.', {
          leadType: ['Locked'],
        });
      }
      if (!allowedLeadTypes(config.settings).includes(input.leadType)) {
        throw new AppError('VALIDATION', 'That lead type is switched off.', {
          leadType: ['Invalid'],
        });
      }
      leadType = input.leadType;
    }
    const customFields = await validatedCustomFields(
      tx,
      ctx,
      input.customFields,
      existing.customFields as Record<string, unknown>,
    );

    const ownerUserId = input.ownerUserId ?? existing.ownerUserId;
    const ownerChanged = ownerUserId !== existing.ownerUserId;
    if (ownerChanged) {
      requirePermission(ctx, 'contacts.assign');
      assertCanAccess(ctx, 'contacts.assign', contactRecord(existing));
      assertCanAssignContact(ctx, ownerUserId);
    }

    const next = {
      ...normalizedFields(ctx, input),
      // Without view_sensitive the form never saw the value, so it must not overwrite it.
      dateOfBirth: canViewSensitive ? input.dateOfBirth : existing.dateOfBirth,
      ownerUserId,
      leadType,
      customFields,
      assignedAt: ownerChanged && ownerUserId ? new Date() : existing.assignedAt,
      consentUpdatedAt:
        input.marketingConsent !== existing.marketingConsent
          ? new Date()
          : existing.consentUpdatedAt,
    };
    const changes = diffChanges(existing, next, ['dateOfBirth', 'emailNormalized', 'phoneE164']);
    delete changes.emailNormalized;
    delete changes.phoneE164;
    delete changes.consentUpdatedAt;
    delete changes.assignedAt;
    if (Object.keys(changes).length === 0) return { id: existing.id, emails: [] as PendingEmail[] };

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
    let emails: PendingEmail[] = [];
    if (ownerChange) {
      await recordSystemActivity(tx, ctx, {
        type: 'owner_changed',
        subject: 'Owner changed',
        contactId: existing.id,
        metadata: { from: ownerChange[0], to: ownerChange[1] },
      });
      await audit(tx, ctx, {
        action: 'owner_change',
        entityType: 'contact',
        entityId: existing.id,
        changes: { ownerUserId: ownerChange },
      });
      if (ownerUserId && isLead) {
        emails = await notify(tx, ctx, [
          {
            userId: ownerUserId,
            type: 'lead_assigned',
            title: `Lead assigned to you: ${[input.firstName, input.lastName].filter(Boolean).join(' ')}`,
            url: `/contacts/${existing.id}`,
            email: true,
          },
        ]);
      }
    }
    return { id: existing.id, emails };
  });
  await deliverEmails(ctx, outcome.emails);
  return { id: outcome.id };
}

export async function deleteContact(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'contacts.delete');
  return withRls(ctx, async (tx) => {
    const existing = await loadForWrite(tx, ctx, id);
    assertCanAccess(ctx, 'contacts.delete', contactRecord(existing));
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
    assertCanAccess(ctx, 'contacts.edit', contactRecord(contact));

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
    assertCanAccess(ctx, 'contacts.edit', contactRecord(contact));

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
