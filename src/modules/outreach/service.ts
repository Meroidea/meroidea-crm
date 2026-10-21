import 'server-only';

import { and, count, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import {
  activities,
  contacts,
  emailTemplates,
  sequenceEnrollments,
  sequences,
  tasks,
  tenantMemberships,
  users,
} from '@/db/schema';
import { startOfZonedDay } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { assertCanAccess } from '@/lib/permissions/scope';
import { recordSystemActivity } from '@/modules/activities/service';
import { assertCanAssignContact, contactRecord } from '@/modules/contacts/access';
import { noteOutreach } from '@/modules/leads/outreach';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';
import { sendEmail } from '@/server/email';
import { enforceRateLimit } from '@/server/rate-limit';
import { renderEmail } from '@/server/email-template';

/** Emails one person may send from the CRM in a day: generous for real work, a brake on misuse. */
export const DAILY_EMAIL_LIMIT = 200;

type SequenceStep = {
  id: string;
  day: number;
  type: 'email' | 'call' | 'meeting' | 'follow_up' | 'other';
  title: string;
  templateId: string | null;
};

async function loadContact(tx: Tx, ctx: TenantContext, id: string) {
  const [contact] = await tx
    .select()
    .from(contacts)
    .where(
      and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, id), isNull(contacts.deletedAt)),
    )
    .limit(1);
  if (!contact) throw new AppError('NOT_FOUND', 'That record was not found.');
  assertCanAccess(ctx, 'contacts.view', contactRecord(contact));
  return contact;
}

/** Fills {{contact.first_name}}-style fields; anything unknown becomes empty, never raw braces. */
export function renderMergeFields(
  text: string,
  values: {
    firstName: string;
    lastName: string | null;
    company: string | null;
    userName: string;
    businessName: string;
  },
): string {
  const map: Record<string, string> = {
    'contact.first_name': values.firstName,
    'contact.last_name': values.lastName ?? '',
    'contact.company': values.company ?? '',
    'user.name': values.userName,
    'business.name': values.businessName,
  };
  return text.replace(
    /\{\{\s*([a-z_.]+)\s*\}\}/gi,
    (_, key: string) => map[key.toLowerCase()] ?? '',
  );
}

/**
 * Sends an email to a contact from inside the CRM (docs/leads.md §4.4): through the platform's
 * sending address, under the sender's name, with replies going to the sender's own mailbox.
 * Respects "do not contact" and "do not email", and is logged on the timeline once sent.
 */
export async function sendContactEmail(
  ctx: TenantContext,
  input: { contactId: string; subject: string; body: string; templateId: string | null },
): Promise<{ id: string }> {
  requirePermission(ctx, 'activities.create');

  const prepared = await withRls(ctx, async (tx) => {
    const contact = await loadContact(tx, ctx, input.contactId);
    if (!contact.email) throw new AppError('VALIDATION', 'This person has no email address.');
    if (contact.anonymizedAt || contact.status === 'do_not_contact' || contact.doNotEmail) {
      throw new AppError('CONFLICT', 'This person asked not to be emailed.');
    }
    if (input.templateId) {
      const [template] = await tx
        .select({ id: emailTemplates.id })
        .from(emailTemplates)
        .where(
          and(
            eq(emailTemplates.tenantId, ctx.tenantId),
            eq(emailTemplates.id, input.templateId),
            eq(emailTemplates.isActive, true),
          ),
        )
        .limit(1);
      if (!template) throw new AppError('VALIDATION', 'That template is not available.');
    }
    const [sent] = await tx
      .select({ total: count() })
      .from(activities)
      .where(
        and(
          eq(activities.tenantId, ctx.tenantId),
          eq(activities.actorUserId, ctx.userId),
          eq(activities.type, 'email'),
          gte(activities.occurredAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
          sql`${activities.metadata} ->> 'sentViaCrm' = 'true'`,
        ),
      );
    if ((sent?.total ?? 0) >= DAILY_EMAIL_LIMIT) {
      throw new AppError(
        'RATE_LIMITED',
        `You can send up to ${DAILY_EMAIL_LIMIT} emails a day from here.`,
      );
    }
    const [me] = await tx
      .select({ fullName: users.fullName, email: users.email })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);
    return { contact, me };
  });

  // The count above misses sends still in flight, so many at once could all pass it. This
  // counter is taken atomically before sending, and holds the line however many arrive together.
  await enforceRateLimit(
    {
      bucket: `crm-email:${ctx.tenantId}`,
      subject: ctx.userId,
      limit: DAILY_EMAIL_LIMIT,
      windowSeconds: 24 * 60 * 60,
    },
    `You can send up to ${DAILY_EMAIL_LIMIT} emails a day from here.`,
  );

  const values = {
    firstName: prepared.contact.firstName,
    lastName: prepared.contact.lastName,
    company: prepared.contact.companyName,
    userName: prepared.me?.fullName ?? '',
    businessName: ctx.tenant.name,
  };
  const subject = renderMergeFields(input.subject, values).slice(0, 200);
  const body = renderMergeFields(input.body, values);
  const result = await sendEmail({
    to: prepared.contact.email!,
    subject,
    // Written by a person to one contact, so it reads like their own email: no banner, and their
    // template already signs it.
    ...renderEmail({
      sender: {
        kind: 'personal',
        name: values.userName || ctx.tenant.name,
        business: ctx.tenant.name,
      },
      preheader: body.replace(/\s+/g, ' ').slice(0, 120),
      blocks: body
        .split(/\n{2,}/)
        .filter((paragraph) => paragraph.trim())
        .map((paragraph) => ({ type: 'paragraph' as const, text: paragraph })),
      signature: [],
      reason: `You received this from ${values.userName || 'someone'} at ${ctx.tenant.name}. Reply to this email to answer them directly.`,
    }),
    replyTo: prepared.me?.email ?? ctx.email,
    fromName: `${values.userName || 'Your contact'} at ${ctx.tenant.name}`,
  });
  if (!result.sent) {
    throw new AppError(
      'INTERNAL',
      result.reason === 'not_configured'
        ? 'Email sending isn’t set up for this workspace yet.'
        : 'The email could not be sent. Try again in a minute.',
    );
  }

  return withRls(ctx, async (tx) => {
    const now = new Date();
    const [created] = await tx
      .insert(activities)
      .values({
        tenantId: ctx.tenantId,
        type: 'email',
        direction: 'outbound',
        subject,
        body,
        occurredAt: now,
        contactId: prepared.contact.id,
        actorUserId: ctx.userId,
        createdBy: ctx.userId,
        metadata: { sentViaCrm: true, templateId: input.templateId },
      })
      .returning({ id: activities.id });
    if (!created) throw new AppError('INTERNAL', 'The email was sent but could not be logged.');
    await tx
      .update(contacts)
      .set({ lastActivityAt: now })
      .where(and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, prepared.contact.id)));
    await noteOutreach(tx, ctx, prepared.contact.id);
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'activity',
      entityId: created.id,
      context: { type: 'email', sentViaCrm: true, contactId: prepared.contact.id },
    });
    return created;
  });
}

const TASK_TYPE: Record<
  SequenceStep['type'],
  'email' | 'call' | 'meeting' | 'follow_up' | 'other'
> = {
  email: 'email',
  call: 'call',
  meeting: 'meeting',
  follow_up: 'follow_up',
  other: 'other',
};

/**
 * Starts a contact on a sequence (docs/leads.md §4.4 cadences): each step becomes a task, due
 * on its day at 9am in the business's timezone, for the person working the lead.
 */
export async function enrollInSequence(
  ctx: TenantContext,
  input: { contactId: string; sequenceId: string; assignedTo: string | null },
): Promise<{ id: string }> {
  requirePermission(ctx, 'tasks.manage');
  requirePermission(ctx, 'contacts.edit');
  return withRls(ctx, async (tx) => {
    const contact = await loadContact(tx, ctx, input.contactId);
    assertCanAccess(ctx, 'contacts.edit', contactRecord(contact));
    const assignedTo = input.assignedTo ?? contact.ownerUserId ?? ctx.userId;
    if (assignedTo !== ctx.userId) {
      requirePermission(ctx, 'tasks.assign_others');
      assertCanAssignContact(ctx, assignedTo);
    }
    const [member] = await tx
      .select({ id: tenantMemberships.id })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, ctx.tenantId),
          eq(tenantMemberships.userId, assignedTo),
          eq(tenantMemberships.status, 'active'),
        ),
      )
      .limit(1);
    if (!member) throw new AppError('VALIDATION', 'Choose an active member of your team.');

    const [sequence] = await tx
      .select()
      .from(sequences)
      .where(
        and(
          eq(sequences.tenantId, ctx.tenantId),
          eq(sequences.id, input.sequenceId),
          eq(sequences.isActive, true),
        ),
      )
      .limit(1);
    if (!sequence) throw new AppError('NOT_FOUND', 'That sequence is not available.');
    const steps = (Array.isArray(sequence.steps) ? sequence.steps : []) as SequenceStep[];
    if (steps.length === 0) throw new AppError('CONFLICT', 'That sequence has no steps.');

    const [enrollment] = await tx
      .insert(sequenceEnrollments)
      .values({
        tenantId: ctx.tenantId,
        sequenceId: sequence.id,
        contactId: contact.id,
        assignedTo,
        enrolledBy: ctx.userId,
      })
      .onConflictDoNothing()
      .returning({ id: sequenceEnrollments.id });
    if (!enrollment) throw new AppError('CONFLICT', 'They are already on that sequence.');

    await tx.insert(tasks).values(
      steps.map((step) => ({
        tenantId: ctx.tenantId,
        title: `${sequence.name}: ${step.title}`.slice(0, 200),
        type: TASK_TYPE[step.type] ?? 'follow_up',
        dueAt: new Date(startOfZonedDay(ctx.tenant.timezone, step.day).getTime() + 9 * 3_600_000),
        assignedTo,
        contactId: contact.id,
        sequenceEnrollmentId: enrollment.id,
        description: step.templateId ? 'Send it from the contact page with its template.' : null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })),
    );
    await recordSystemActivity(tx, ctx, {
      type: 'assigned',
      subject: `Started sequence “${sequence.name}” (${steps.length} steps)`,
      contactId: contact.id,
      metadata: { enrollmentId: enrollment.id, sequenceId: sequence.id },
    });
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'sequence_enrollment',
      entityId: enrollment.id,
      context: { contactId: contact.id, sequenceId: sequence.id, assignedTo },
    });
    return enrollment;
  });
}

/** Stops a sequence for a contact: its open tasks are cancelled, done ones stay done. */
export async function stopEnrollment(
  ctx: TenantContext,
  enrollmentId: string,
): Promise<{ id: string }> {
  requirePermission(ctx, 'tasks.manage');
  return withRls(ctx, async (tx) => {
    const [enrollment] = await tx
      .select()
      .from(sequenceEnrollments)
      .where(
        and(
          eq(sequenceEnrollments.tenantId, ctx.tenantId),
          eq(sequenceEnrollments.id, enrollmentId),
        ),
      )
      .limit(1)
      .for('update');
    if (!enrollment || enrollment.status !== 'active') {
      throw new AppError('NOT_FOUND', 'That sequence is not running.');
    }
    const contact = await loadContact(tx, ctx, enrollment.contactId);
    assertCanAccess(ctx, 'contacts.edit', contactRecord(contact));
    const now = new Date();
    await tx
      .update(tasks)
      .set({ status: 'cancelled', updatedBy: ctx.userId })
      .where(
        and(
          eq(tasks.tenantId, ctx.tenantId),
          eq(tasks.sequenceEnrollmentId, enrollment.id),
          inArray(tasks.status, ['open']),
        ),
      );
    await tx
      .update(sequenceEnrollments)
      .set({ status: 'stopped', endedAt: now })
      .where(eq(sequenceEnrollments.id, enrollment.id));
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'sequence_enrollment',
      entityId: enrollment.id,
      changes: { status: ['active', 'stopped'] },
    });
    return { id: enrollment.id };
  });
}
