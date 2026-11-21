import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { tenantMemberships, users } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';
import { isEmailConfigured, sendEmail } from '@/server/email';
import { renderEmail } from '@/server/email-template';
import { enforceRateLimit } from '@/server/rate-limit';

import type { StaffEmailInput } from './schemas';

/** A business emails its staff a handful of times a day at most; more is a mistake or a loop. */
const DAILY_STAFF_EMAILS = 10;

/**
 * Emails some or all of the business's active staff logins, from the business, with replies
 * going to the person who sent it. Needs `users.manage` (the Admin by default): whoever manages
 * the team's logins may write to all of them. Every recipient is checked to be an active member
 * of this business at the moment of sending. The audit row records how many it went to, never
 * what it said (rules/security.md).
 */
export async function emailStaff(
  ctx: TenantContext,
  input: StaffEmailInput,
): Promise<{ recipients: number; sent: number; failed: number }> {
  requirePermission(ctx, 'users.manage');
  if (!isEmailConfigured()) {
    throw new AppError('CONFLICT', 'Email is not set up for this workspace, so nothing was sent.');
  }

  const people = await withRls(ctx, async (tx) => {
    const sender = await tx
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);
    const recipients = await tx
      .select({ id: users.id, email: users.email, fullName: users.fullName })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(
        and(
          eq(tenantMemberships.tenantId, ctx.tenantId),
          eq(tenantMemberships.status, 'active'),
          eq(tenantMemberships.isSupport, false),
          inArray(tenantMemberships.userId, input.userIds),
        ),
      );
    return { senderName: sender[0]?.fullName ?? ctx.tenant.name, recipients };
  });
  if (people.recipients.length !== input.userIds.length) {
    throw new AppError(
      'VALIDATION',
      'Some of those people are no longer active staff here. Choose the recipients again.',
    );
  }

  await enforceRateLimit(
    {
      bucket: `staff-email:${ctx.tenantId}`,
      subject: ctx.userId,
      limit: DAILY_STAFF_EMAILS,
      windowSeconds: 24 * 60 * 60,
    },
    `You can send up to ${DAILY_STAFF_EMAILS} staff emails a day.`,
  );

  const paragraphs = input.body
    .split(/\n\s*\n/)
    .map((text) => text.trim())
    .filter(Boolean);
  let sent = 0;
  // One at a time: a provider's per-second limit would otherwise fail part of a large send.
  for (const person of people.recipients) {
    const email = renderEmail({
      sender: { kind: 'business', name: ctx.tenant.name, color: ctx.tenant.primaryColor },
      preheader: paragraphs[0]?.slice(0, 120) ?? input.subject,
      heading: input.subject,
      blocks: [
        { type: 'paragraph', text: `Hi ${person.fullName ?? 'there'},` },
        ...paragraphs.map((text) => ({ type: 'paragraph' as const, text })),
      ],
      signature: [people.senderName, ctx.tenant.name],
      reason: `You received this because you work at ${ctx.tenant.name}.`,
    });
    const outcome = await sendEmail({
      to: person.email,
      subject: input.subject,
      ...email,
      replyTo: ctx.email || undefined,
      fromName: `${people.senderName} at ${ctx.tenant.name}`,
    });
    if (outcome.sent) sent += 1;
  }

  const result = {
    recipients: people.recipients.length,
    sent,
    failed: people.recipients.length - sent,
  };
  await withRls(ctx, (tx) =>
    audit(tx, ctx, {
      action: 'create',
      entityType: 'staff_email',
      entityId: null,
      context: result,
    }),
  );
  return result;
}
