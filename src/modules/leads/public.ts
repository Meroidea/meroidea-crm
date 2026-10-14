import 'server-only';

import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import {
  auditLogs,
  contacts,
  leadIntakeEvents,
  leadStatuses,
  tenantMemberships,
  tenants,
  users,
  webForms,
} from '@/db/schema';
import { AppError } from '@/lib/errors';
import { normalizeEmail, normalizePhone } from '@/lib/normalize';
import { recordSystemActivity } from '@/modules/activities/service';
import { notify, sendNoticeEmails, type PendingEmail } from '@/modules/notifications/service';
import { adminDb } from '@/server/db/admin';
import { enforceRateLimit } from '@/server/rate-limit';

import { systemStatus, type LeadStatus } from './config';
import { routeLead } from './routing';
import { UTM_KEYS, type WebFormSubmission } from './schemas';

/**
 * The public side of a business's website forms (docs/leads.md §3.1). There is no session, so
 * this file uses the privileged client. It always starts from the form's key, never accepts a
 * business, record or user id from the caller, and never tells the sender whether their address
 * was already known (rules/security.md, public endpoints).
 */

const KEY = /^[A-Za-z0-9_-]{16,64}$/;
/** Enquiries one sender may make through a form per hour, and one form accepts from everyone. */
const SENDER_HOURLY_LIMIT = 5;
const FORM_HOURLY_LIMIT = 300;
/** Businesses whose people can work leads; a suspended or not-yet-agreed one takes none. */
const OPEN_STATUSES = ['trialing', 'active', 'past_due'] as const;

async function formByKey(key: string) {
  if (!KEY.test(key)) return null;
  const [row] = await adminDb()
    .select({
      id: webForms.id,
      tenantId: webForms.tenantId,
      name: webForms.name,
      sourceId: webForms.sourceId,
      subSourceId: webForms.subSourceId,
      leadType: webForms.leadType,
      thankYouMessage: webForms.thankYouMessage,
      askCompany: webForms.askCompany,
      askMessage: webForms.askMessage,
      askConsent: webForms.askConsent,
      createdBy: webForms.createdBy,
      businessName: tenants.name,
      country: tenants.defaultCountry,
    })
    .from(webForms)
    .innerJoin(tenants, eq(tenants.id, webForms.tenantId))
    .where(
      and(
        eq(webForms.publicKey, key),
        eq(webForms.isActive, true),
        inArray(tenants.status, [...OPEN_STATUSES]),
        sql`'crm' = any(${tenants.features})`,
      ),
    )
    .limit(1);
  return row ?? null;
}

export type PublicWebForm = {
  businessName: string;
  name: string;
  askCompany: boolean;
  askMessage: boolean;
  askConsent: boolean;
  thankYouMessage: string | null;
};

export async function getPublicWebForm(key: string): Promise<PublicWebForm | null> {
  const form = await formByKey(key);
  if (!form) return null;
  return {
    businessName: form.businessName,
    name: form.name,
    askCompany: form.askCompany,
    askMessage: form.askMessage,
    askConsent: form.askConsent,
    thankYouMessage: form.thankYouMessage,
  };
}

/**
 * Takes an enquiry. A new address becomes a lead in the New status with the form's source and
 * sub-source, routed by the business's rules (or left in the queue); a known address adds the
 * enquiry to that person's timeline instead of making a duplicate. Either way the submission is
 * kept as received in lead_intake_events.
 */
export async function submitWebForm(
  key: string,
  input: WebFormSubmission,
  sender: string | null,
): Promise<{ thankYouMessage: string | null }> {
  const form = await formByKey(key);
  if (!form) throw new AppError('NOT_FOUND', 'This form is not available.');
  await enforceRateLimit(
    {
      bucket: `webform:${form.id}`,
      subject: sender,
      limit: SENDER_HOURLY_LIMIT,
      windowSeconds: 3600,
    },
    'You have sent several enquiries already. Please wait a while before sending another.',
  );
  const db = adminDb();
  const [recent] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(leadIntakeEvents)
    .where(
      and(
        eq(leadIntakeEvents.tenantId, form.tenantId),
        eq(leadIntakeEvents.webFormId, form.id),
        gte(leadIntakeEvents.receivedAt, new Date(Date.now() - 60 * 60 * 1000)),
      ),
    );
  if ((recent?.total ?? 0) >= FORM_HOURLY_LIMIT) {
    throw new AppError(
      'RATE_LIMITED',
      'We are receiving a lot of enquiries right now. Try again later.',
    );
  }

  // Only what the form asks for is kept; anything else a script adds is dropped.
  const submission = {
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    companyName: form.askCompany ? input.companyName : null,
    jobTitle: form.askCompany ? input.jobTitle : null,
    message: form.askMessage ? input.message : null,
    consent: form.askConsent ? input.consent : false,
  };
  const utmEntries = UTM_KEYS.flatMap((utmKey) => {
    const value = input[utmKey];
    return value ? [[utmKey, value] as const] : [];
  });
  const utm = utmEntries.length > 0 ? Object.fromEntries(utmEntries) : null;
  const email = normalizeEmail(submission.email);
  const phone = normalizePhone(submission.phone, form.country);
  const consentSource = `Website form: ${form.name}`.slice(0, 80);
  const system = { tenantId: form.tenantId, userId: null };

  const emails = await db.transaction(async (tx) => {
    const [event] = await tx
      .insert(leadIntakeEvents)
      .values({
        tenantId: form.tenantId,
        channel: 'web_form',
        webFormId: form.id,
        payload: { ...submission, utm },
      })
      .returning({ id: leadIntakeEvents.id });
    if (!event) throw new AppError('INTERNAL', 'Your enquiry could not be saved.');

    const now = new Date();
    const subject = `Enquiry from the website form “${form.name}”`;
    const [existing] = email
      ? await tx
          .select({
            id: contacts.id,
            ownerUserId: contacts.ownerUserId,
            marketingConsent: contacts.marketingConsent,
          })
          .from(contacts)
          .where(
            and(
              eq(contacts.tenantId, form.tenantId),
              eq(contacts.emailNormalized, email),
              isNull(contacts.deletedAt),
            ),
          )
          .limit(1)
      : [];

    let contactId: string;
    let recipient: string | null;
    let notice: 'enquiry_received' | 'lead_assigned';
    if (existing) {
      contactId = existing.id;
      recipient = existing.ownerUserId;
      notice = 'enquiry_received';
      // A new yes to marketing is recorded; a form never takes an earlier yes away.
      await tx
        .update(contacts)
        .set({
          lastActivityAt: now,
          ...(submission.consent && !existing.marketingConsent
            ? { marketingConsent: true, consentUpdatedAt: now, consentSource }
            : {}),
        })
        .where(and(eq(contacts.tenantId, form.tenantId), eq(contacts.id, existing.id)));
    } else {
      const statuses = await tx
        .select({
          id: leadStatuses.id,
          name: leadStatuses.name,
          kind: leadStatuses.kind,
          leadType: leadStatuses.leadType,
          requiresReason: leadStatuses.requiresReason,
          isSystem: leadStatuses.isSystem,
          color: leadStatuses.color,
          isActive: leadStatuses.isActive,
          position: leadStatuses.position,
        })
        .from(leadStatuses)
        .where(and(eq(leadStatuses.tenantId, form.tenantId), eq(leadStatuses.isSystem, true)));
      const status = systemStatus({ statuses: statuses as LeadStatus[] }, 'new', form.leadType);
      const owner = await routeLead(
        tx,
        form.tenantId,
        {
          leadType: form.leadType,
          sourceId: form.sourceId,
          subSourceId: form.subSourceId,
          country: null,
          region: null,
          industry: null,
          companySize: null,
          language: null,
          interest: null,
        },
        'intake',
      );
      const [created] = await tx
        .insert(contacts)
        .values({
          tenantId: form.tenantId,
          firstName: submission.firstName,
          lastName: submission.lastName,
          email: submission.email,
          emailNormalized: email,
          phone: submission.phone,
          phoneE164: phone,
          companyName: submission.companyName,
          jobTitle: submission.jobTitle,
          sourceId: form.sourceId,
          subSourceId: form.subSourceId,
          campaignName: utm?.utm_campaign?.slice(0, 120) ?? null,
          utm,
          leadType: form.leadType,
          leadStatusId: status.id,
          leadStatusChangedAt: now,
          ownerUserId: owner,
          assignedAt: owner ? now : null,
          marketingConsent: submission.consent,
          consentUpdatedAt: submission.consent ? now : null,
          consentSource: submission.consent ? consentSource : null,
          lastActivityAt: now,
        })
        .returning({ id: contacts.id });
      if (!created) throw new AppError('INTERNAL', 'Your enquiry could not be saved.');
      contactId = created.id;
      recipient = owner;
      notice = 'lead_assigned';
    }

    await recordSystemActivity(tx, system, {
      type: 'enquiry',
      subject,
      body: submission.message,
      contactId,
      metadata: { webFormId: form.id, intakeEventId: event.id, ...(utm ? { utm } : {}) },
    });
    await tx
      .update(leadIntakeEvents)
      .set({ status: existing ? 'matched' : 'created', contactId, processedAt: now })
      .where(eq(leadIntakeEvents.id, event.id));
    await tx.insert(auditLogs).values({
      tenantId: form.tenantId,
      actorUserId: null,
      actorType: 'system',
      action: existing ? 'update' : 'create',
      entityType: 'contact',
      entityId: contactId,
      context: { source: 'web_form', webFormId: form.id, matched: Boolean(existing) },
    });

    // Nobody owns it yet: the person who set the form up hears about it, while still on the team.
    if (!recipient && form.createdBy) {
      const [member] = await tx
        .select({ userId: tenantMemberships.userId })
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.tenantId, form.tenantId),
            eq(tenantMemberships.userId, form.createdBy),
            eq(tenantMemberships.status, 'active'),
          ),
        )
        .limit(1);
      recipient = member?.userId ?? null;
      notice = 'enquiry_received';
    }
    if (!recipient) return [] as PendingEmail[];
    return notify(tx, system, [
      {
        userId: recipient,
        type: notice,
        title: existing
          ? `New enquiry from ${submission.firstName} through “${form.name}”`
          : `New lead from the website: ${[submission.firstName, submission.lastName].filter(Boolean).join(' ')}`,
        url: `/contacts/${contactId}`,
        email: true,
      },
    ]);
  });

  if (emails.length > 0) {
    const recipients = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(
        inArray(
          users.id,
          emails.map((item) => item.userId),
        ),
      );
    await sendNoticeEmails(form.businessName, emails, recipients).catch(() => undefined);
  }
  return { thankYouMessage: form.thankYouMessage };
}
