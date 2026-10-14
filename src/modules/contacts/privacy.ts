import 'server-only';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { contacts } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { assertCanAccess } from '@/lib/permissions/scope';
import { recordSystemActivity, redactContactActivities } from '@/modules/activities/service';
import { redactContactTasks } from '@/modules/tasks/service';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import { contactRecord } from './access';

type ContactRow = typeof contacts.$inferSelect;

const blank = (value: unknown) => value === null || value === undefined || value === '';

/** Plain fields the kept record takes from the duplicate only where it has nothing. */
const FILL_FIELDS = [
  'lastName',
  'altPhone',
  'dateOfBirth',
  'gender',
  'addressLine',
  'city',
  'region',
  'country',
  'campaignName',
  'utm',
  'jobTitle',
  'companyName',
  'companyWebsite',
  'companySize',
  'industry',
  'linkedinUrl',
  'language',
  'interest',
  'importBatchId',
  'originatorUserId',
] as const satisfies readonly (keyof ContactRow)[];

/** What the kept record looks like once the duplicate's details have filled its gaps. */
function mergedValues(keep: ContactRow, drop: ContactRow): Partial<ContactRow> {
  const next: Partial<ContactRow> = {};
  for (const field of FILL_FIELDS) {
    if (blank(keep[field]) && !blank(drop[field])) Object.assign(next, { [field]: drop[field] });
  }
  // Pairs move together, so a normalised value never disagrees with what was typed.
  if (!keep.email && drop.email) {
    next.email = drop.email;
    next.emailNormalized = drop.emailNormalized;
  }
  if (!keep.phone && drop.phone) {
    next.phone = drop.phone;
    next.phoneE164 = drop.phoneE164;
  }
  if (!keep.sourceId && drop.sourceId) {
    next.sourceId = drop.sourceId;
    next.subSourceId = drop.subSourceId;
  }
  if (!keep.ownerUserId && drop.ownerUserId) {
    next.ownerUserId = drop.ownerUserId;
    next.assignedAt = drop.assignedAt;
  }
  // A lead's progress comes across when the kept record isn't being worked as a lead.
  if (!keep.leadStatusId && drop.leadStatusId) {
    Object.assign(next, {
      leadType: drop.leadType,
      leadStatusId: drop.leadStatusId,
      leadStatusChangedAt: drop.leadStatusChangedAt,
      leadReasonId: drop.leadReasonId,
      leadReasonNote: drop.leadReasonNote,
      firstContactedAt: drop.firstContactedAt,
      handoverToUserId: drop.handoverToUserId,
      handoverAt: drop.handoverAt,
      handoverDueAt: drop.handoverDueAt,
      handoverMeetingAt: drop.handoverMeetingAt,
      handoverSummary: drop.handoverSummary,
      rejectedReasonId: drop.rejectedReasonId,
      rejectedNote: drop.rejectedNote,
      rejectedAt: drop.rejectedAt,
      rejectedBy: drop.rejectedBy,
      convertedAt: drop.convertedAt,
    });
  }
  const custom = {
    ...(drop.customFields as Record<string, unknown>),
    ...(keep.customFields as Record<string, unknown>),
  };
  if (Object.keys(custom).length > Object.keys(keep.customFields as object).length) {
    next.customFields = custom;
  }
  // Privacy choices: a "no" on either record wins, and the latest consent answer stands.
  if (drop.doNotEmail && !keep.doNotEmail) next.doNotEmail = true;
  if (drop.doNotCall && !keep.doNotCall) next.doNotCall = true;
  if (drop.status === 'do_not_contact' && keep.status !== 'do_not_contact') {
    next.status = 'do_not_contact';
  }
  if (
    drop.consentUpdatedAt &&
    (!keep.consentUpdatedAt || drop.consentUpdatedAt > keep.consentUpdatedAt) &&
    drop.marketingConsent !== keep.marketingConsent
  ) {
    next.marketingConsent = drop.marketingConsent;
    next.consentUpdatedAt = drop.consentUpdatedAt;
    next.consentSource = drop.consentSource;
  }
  if (drop.lastActivityAt && (!keep.lastActivityAt || drop.lastActivityAt > keep.lastActivityAt)) {
    next.lastActivityAt = drop.lastActivityAt;
  }
  return next;
}

/**
 * Merges two records of the same person (docs/leads.md §3.4): the kept record takes the
 * duplicate's details where it has none, and everything attached to the duplicate — timeline,
 * tasks, opportunities, organizations, household links, sequences, tickets — moves across. The
 * duplicate is then deleted (soft, so the audit trail still resolves it).
 */
export async function mergeContacts(
  ctx: TenantContext,
  input: { keepId: string; dropId: string },
): Promise<{ id: string }> {
  requirePermission(ctx, 'contacts.merge');
  requirePermission(ctx, 'contacts.edit');
  if (input.keepId === input.dropId) {
    throw new AppError('VALIDATION', 'Choose two different records.');
  }
  return withRls(ctx, async (tx) => {
    // Locked in id order, so two merges of the same pair can't deadlock.
    const rows = await tx
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.tenantId, ctx.tenantId),
          inArray(contacts.id, [input.keepId, input.dropId]),
          isNull(contacts.deletedAt),
        ),
      )
      .orderBy(contacts.id)
      .for('update');
    const keep = rows.find((row) => row.id === input.keepId);
    const drop = rows.find((row) => row.id === input.dropId);
    if (!keep || !drop) throw new AppError('NOT_FOUND', 'That record was not found.');
    assertCanAccess(ctx, 'contacts.edit', contactRecord(keep));
    assertCanAccess(ctx, 'contacts.edit', contactRecord(drop));
    if (keep.anonymizedAt || drop.anonymizedAt) {
      throw new AppError('CONFLICT', 'An erased record can’t be merged.');
    }

    const next = mergedValues(keep, drop);
    await tx.execute(sql`select app.merge_contact_references(${keep.id}::uuid, ${drop.id}::uuid)`);
    const now = new Date();
    await tx
      .update(contacts)
      .set({ deletedAt: now, updatedBy: ctx.userId })
      .where(and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, drop.id)));
    if (Object.keys(next).length > 0) {
      await tx
        .update(contacts)
        .set({ ...next, updatedBy: ctx.userId })
        .where(and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, keep.id)));
    }
    const dropName = [drop.firstName, drop.lastName].filter(Boolean).join(' ');
    await recordSystemActivity(tx, ctx, {
      type: 'merged',
      subject: `Merged with a duplicate record (${dropName})`,
      contactId: keep.id,
      metadata: { mergedFrom: drop.id, filled: Object.keys(next) },
    });
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'contact',
      entityId: keep.id,
      context: { mergedFrom: drop.id, filledFields: Object.keys(next) },
    });
    await audit(tx, ctx, {
      action: 'delete',
      entityType: 'contact',
      entityId: drop.id,
      context: { mergedInto: keep.id },
    });
    return { id: keep.id };
  });
}

/**
 * Erases a person on request (docs/leads.md §6.5): their name, contact details, address, notes,
 * the business's own fields and what was written on the timeline are cleared; the record stays
 * as "Erased" so counts, opportunities and reports still add up, and they are marked do-not-
 * contact so no list or sequence reaches them again. It cannot be undone.
 */
export async function anonymizeContact(ctx: TenantContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx, 'contacts.anonymize');
  return withRls(ctx, async (tx) => {
    const [contact] = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, id)))
      .limit(1)
      .for('update');
    if (!contact) throw new AppError('NOT_FOUND', 'That record was not found.');
    assertCanAccess(ctx, 'contacts.view', contactRecord(contact));
    if (contact.anonymizedAt) throw new AppError('CONFLICT', 'This record is already erased.');

    const now = new Date();
    await tx
      .update(contacts)
      .set({
        firstName: 'Erased',
        lastName: null,
        email: null,
        emailNormalized: null,
        phone: null,
        phoneE164: null,
        altPhone: null,
        dateOfBirth: null,
        gender: null,
        addressLine: null,
        city: null,
        region: null,
        jobTitle: null,
        linkedinUrl: null,
        language: null,
        interest: null,
        customFields: {},
        leadReasonNote: null,
        handoverSummary: null,
        rejectedNote: null,
        consentSource: null,
        marketingConsent: false,
        consentUpdatedAt: now,
        doNotEmail: true,
        doNotCall: true,
        status: 'do_not_contact',
        anonymizedAt: now,
        updatedBy: ctx.userId,
      })
      .where(and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, contact.id)));
    await redactContactActivities(tx, ctx, contact.id);
    await redactContactTasks(tx, ctx, contact.id);
    await tx.execute(sql`select app.erase_contact_traces(${contact.id}::uuid)`);
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'contact',
      entityId: contact.id,
      context: { erasedOnRequest: true },
    });
    return { id: contact.id };
  });
}
