import 'server-only';

import { and, eq, inArray, isNull } from 'drizzle-orm';

import { notifications, users } from '@/db/schema';
import { escapeHtml } from '@/lib/html';
import type { TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';
import { sendEmail } from '@/server/email';
import { serverEnv } from '@/server/env';

/**
 * What a notice is about. The email for each kind says only that something is waiting and links
 * to it: names and details of leads stay inside the workspace, out of inboxes (rules/security.md).
 */
export const NOTIFICATION_EMAIL: Record<string, string> = {
  lead_assigned: 'A new lead has been assigned to you',
  handover_received: 'A lead has been handed over to you to accept',
  handover_accepted: 'A lead you handed over was accepted',
  handover_rejected: 'A lead you handed over was returned to you',
  stage_assigned: 'An opportunity has moved into a stage you are responsible for',
  approval_requested: 'An opportunity is waiting for your approval',
  approval_decided: 'Your approval request has been answered',
  lead_unassigned: 'Leads are waiting to be assigned',
  first_contact_overdue: 'A lead is waiting for its first contact',
  acceptance_overdue: 'A handed-over lead is waiting to be accepted',
  stale_lead: 'A lead has gone quiet',
  stale_opportunity: 'An opportunity has gone quiet',
  task_overdue: 'You have an overdue task',
  enquiry_received: 'A new enquiry arrived from your website',
  features_enabled: 'New features have been switched on for your business',
};

export type NoticeInput = {
  userId: string;
  type: keyof typeof NOTIFICATION_EMAIL;
  /** Shown in the workspace only. */
  title: string;
  body?: string | null;
  url: string;
  dedupeKey?: string | null;
  /** Also send an email (sent after the change is saved; see deliverEmails). */
  email?: boolean;
};

export type PendingEmail = { userId: string; type: string; url: string };

/**
 * Records notices inside the caller's transaction. Returns the emails to send once that
 * transaction has committed, so a notice is never emailed about a change that rolled back.
 * Nobody is notified about their own action.
 */
export async function notify(
  tx: Tx,
  ctx: { tenantId: string; userId: string | null },
  notices: NoticeInput[],
): Promise<PendingEmail[]> {
  const wanted = notices.filter((notice) => notice.userId !== ctx.userId);
  if (wanted.length === 0) return [];
  await tx
    .insert(notifications)
    .values(
      wanted.map((notice) => ({
        tenantId: ctx.tenantId,
        userId: notice.userId,
        type: notice.type,
        title: notice.title.slice(0, 200),
        body: notice.body?.slice(0, 500) ?? null,
        url: notice.url,
        dedupeKey: notice.dedupeKey ?? null,
      })),
    )
    .onConflictDoNothing();
  return wanted
    .filter((notice) => notice.email)
    .map((notice) => ({ userId: notice.userId, type: notice.type, url: notice.url }));
}

/** Sends the emails notify() returned. Best effort: a failed email never undoes the change. */
export async function deliverEmails(ctx: TenantContext, pending: PendingEmail[]): Promise<void> {
  if (pending.length === 0) return;
  const recipients = await withRls(ctx, (tx) =>
    tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(
        inArray(
          users.id,
          pending.map((item) => item.userId),
        ),
      ),
  );
  await sendNoticeEmails(ctx.tenant.name, pending, recipients);
}

/**
 * The emails themselves, once the recipients' addresses are known. Public intake (a website
 * form has no session) looks the addresses up its own way and calls this directly.
 */
export async function sendNoticeEmails(
  businessName: string,
  pending: PendingEmail[],
  recipients: { id: string; email: string }[],
): Promise<void> {
  const appUrl = serverEnv().APP_URL;
  await Promise.all(
    pending.map(async (item) => {
      const to = recipients.find((recipient) => recipient.id === item.userId)?.email;
      if (!to) return;
      const subject = NOTIFICATION_EMAIL[item.type] ?? 'You have a new notification';
      const link = new URL(item.url, appUrl).toString();
      const intro = `${subject} in ${businessName} on Meroidea.`;
      await sendEmail({
        to,
        subject,
        text: `${intro}\n\nOpen it: ${link}`,
        html: `<p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(link)}">Open it in Meroidea</a></p>`,
      });
    }),
  );
}

export async function markRead(ctx: TenantContext, id: string | 'all'): Promise<{ id: string }> {
  return withRls(ctx, async (tx) => {
    await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.tenantId, ctx.tenantId),
          eq(notifications.userId, ctx.userId),
          isNull(notifications.readAt),
          id === 'all' ? undefined : eq(notifications.id, id),
        ),
      );
    return { id };
  });
}
