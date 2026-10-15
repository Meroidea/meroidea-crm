import 'server-only';

import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import {
  auditLogs,
  contacts,
  customFieldDefinitions,
  leadIntakeEvents,
  leadStatuses,
  tenantMemberships,
  tenants,
  users,
  webForms,
} from '@/db/schema';
import { AppError } from '@/lib/errors';
import { choicesOf, type CustomFieldDefinition } from '@/modules/custom-fields/validation';
import { normalizeEmail, normalizePhone } from '@/lib/normalize';
import { recordSystemActivity } from '@/modules/activities/service';
import { notify, sendNoticeEmails, type PendingEmail } from '@/modules/notifications/service';
import { adminDb } from '@/server/db/admin';
import { enforceRateLimit } from '@/server/rate-limit';

import { systemStatus, type LeadStatus } from './config';
import { readAnswers } from './form-answers';
import { readFormFields, renderFields, type RenderedField } from './form-fields';
import { routeLead } from './routing';
import { UTM_KEYS } from './schemas';

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
      heading: webForms.heading,
      intro: webForms.intro,
      submitLabel: webForms.submitLabel,
      fields: webForms.fields,
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

/** The business's own contact fields, for the forms of one business. */
async function contactFields(tenantId: string): Promise<CustomFieldDefinition[]> {
  const rows = await adminDb()
    .select()
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.tenantId, tenantId),
        eq(customFieldDefinitions.entityType, 'contact'),
      ),
    );
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    fieldType: row.fieldType,
    choices: choicesOf(row.options),
    isRequired: row.isRequired,
    isActive: row.isActive,
    showInList: row.showInList,
  }));
}

export type PublicWebForm = {
  businessName: string;
  heading: string;
  intro: string | null;
  submitLabel: string | null;
  thankYouMessage: string | null;
  fields: RenderedField[];
};

export async function getPublicWebForm(key: string): Promise<PublicWebForm | null> {
  const form = await formByKey(key);
  if (!form) return null;
  return {
    businessName: form.businessName,
    heading: form.heading ?? form.name,
    intro: form.intro,
    submitLabel: form.submitLabel,
    thankYouMessage: form.thankYouMessage,
    fields: renderFields(readFormFields(form.fields), await contactFields(form.tenantId)),
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
  body: Record<string, unknown>,
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

  // Only what the form asks for is read; anything else a script adds is dropped.
  const definitions = await contactFields(form.tenantId);
  const fields = renderFields(readFormFields(form.fields), definitions);
  const { answers, errors } = readAnswers(fields, definitions, body);
  if (Object.keys(errors).length > 0) {
    throw new AppError('VALIDATION', 'Please check the highlighted fields.', errors);
  }
  const person = answers.contact;
  const firstName = person.firstName ?? '';
  const utmEntries = UTM_KEYS.flatMap((utmKey) => {
    const value = body[utmKey];
    return typeof value === 'string' && value.trim()
      ? [[utmKey, value.trim().slice(0, 200)] as const]
      : [];
  });
  const utm = utmEntries.length > 0 ? Object.fromEntries(utmEntries) : null;
  const email = normalizeEmail(person.email);
  const phone = normalizePhone(person.phone, form.country);
  const consentSource = `Website form: ${form.name}`.slice(0, 80);
  const system = { tenantId: form.tenantId, userId: null };

  const emails = await db.transaction(async (tx) => {
    const [event] = await tx
      .insert(leadIntakeEvents)
      .values({
        tenantId: form.tenantId,
        channel: 'web_form',
        webFormId: form.id,
        payload: {
          ...person,
          message: answers.message,
          consent: answers.consent,
          custom: answers.custom,
          utm,
        },
      })
      .returning({ id: leadIntakeEvents.id });
    if (!event) throw new AppError('INTERNAL', 'Your enquiry could not be saved.');

    const now = new Date();
    const subject = `Enquiry from the website form “${form.name}”`;
    // The same person writing again is found by email, or by phone when the form asked no email.
    const [existing] =
      email || phone
        ? await tx
            .select({
              id: contacts.id,
              ownerUserId: contacts.ownerUserId,
              marketingConsent: contacts.marketingConsent,
              record: contacts,
            })
            .from(contacts)
            .where(
              and(
                eq(contacts.tenantId, form.tenantId),
                email ? eq(contacts.emailNormalized, email) : eq(contacts.phoneE164, phone!),
                isNull(contacts.deletedAt),
              ),
            )
            .limit(1)
        : [];
    const details = {
      lastName: person.lastName ?? null,
      city: person.city ?? null,
      region: person.region ?? null,
      language: person.language ?? null,
      companyName: person.companyName ?? null,
      jobTitle: person.jobTitle ?? null,
      companyWebsite: person.companyWebsite ?? null,
      companySize: person.companySize ?? null,
      industry: person.industry ?? null,
      interest: person.interest ?? null,
    };

    let contactId: string;
    let recipient: string | null;
    let notice: 'enquiry_received' | 'lead_assigned';
    if (existing) {
      contactId = existing.id;
      recipient = existing.ownerUserId;
      notice = 'enquiry_received';
      // What the form adds fills the record's gaps; nothing already there is overwritten. A new
      // yes to marketing is recorded; a form never takes an earlier yes away.
      const fill: Record<string, unknown> = {};
      for (const [column, value] of Object.entries(details)) {
        const current = existing.record[column as keyof typeof existing.record];
        if (value && (current === null || current === '')) fill[column] = value;
      }
      if (!existing.record.email && person.email) {
        fill.email = person.email;
        fill.emailNormalized = email;
      }
      if (!existing.record.phone && person.phone) {
        fill.phone = person.phone;
        fill.phoneE164 = phone;
      }
      const known = existing.record.customFields as Record<string, unknown>;
      if (Object.keys(answers.custom).some((customKey) => known[customKey] === undefined)) {
        fill.customFields = { ...answers.custom, ...known };
      }
      await tx
        .update(contacts)
        .set({
          ...fill,
          lastActivityAt: now,
          ...(answers.consent && !existing.marketingConsent
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
          country: form.country,
          region: details.region,
          industry: details.industry,
          companySize: details.companySize,
          language: details.language,
          interest: details.interest,
        },
        'intake',
      );
      const [created] = await tx
        .insert(contacts)
        .values({
          tenantId: form.tenantId,
          firstName,
          ...details,
          email: person.email ?? null,
          emailNormalized: email,
          phone: person.phone ?? null,
          phoneE164: phone,
          customFields: answers.custom,
          sourceId: form.sourceId,
          subSourceId: form.subSourceId,
          campaignName: utm?.utm_campaign?.slice(0, 120) ?? null,
          utm,
          leadType: form.leadType,
          leadStatusId: status.id,
          leadStatusChangedAt: now,
          ownerUserId: owner,
          assignedAt: owner ? now : null,
          marketingConsent: answers.consent,
          consentUpdatedAt: answers.consent ? now : null,
          consentSource: answers.consent ? consentSource : null,
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
      // Their message, then what else they answered, so the enquiry reads whole on the timeline.
      body: [answers.message, answers.summary.join('\n')].filter(Boolean).join('\n\n') || null,
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
          ? `New enquiry from ${firstName} through “${form.name}”`
          : `New lead from the website: ${[firstName, person.lastName].filter(Boolean).join(' ')}`,
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
