import 'server-only';

import { and, eq, inArray, isNull } from 'drizzle-orm';

import { notifications, users } from '@/db/schema';
import type { TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';
import { sendEmail } from '@/server/email';
import { serverEnv } from '@/server/env';
import { renderEmail } from '@/server/email-template';

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

export type PendingEmail = {
  userId: string;
  type: string;
  url: string;
  /** The notification it is about, when it is one already stored (alerts). */
  id?: string;
};

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
 *
 * Notices of one kind for one person go as a single email ("8 of these are waiting"), not one
 * each: an upload or a sweep can raise dozens at once. Sent one after another rather than all at
 * once. Returns the notices whose email could not be sent, so they can be tried again.
 */
export async function sendNoticeEmails(
  businessName: string,
  pending: PendingEmail[],
  recipients: { id: string; email: string }[],
): Promise<{ failed: PendingEmail[] }> {
  const appUrl = serverEnv().APP_URL;
  const groups = new Map<string, PendingEmail[]>();
  for (const item of pending) {
    const key = `${item.userId}|${item.type}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const failed: PendingEmail[] = [];
  for (const items of groups.values()) {
    const first = items[0];
    if (!first) continue;
    const to = recipients.find((recipient) => recipient.id === first.userId)?.email;
    if (!to) continue;
    const subject = NOTIFICATION_EMAIL[first.type] ?? 'You have a new notification';
    const many = items.length > 1;
    const link = new URL(many ? '/notifications' : first.url, appUrl).toString();
    const intro = many
      ? `${subject} in ${businessName} on Meroidea, and ${items.length - 1} more like it.`
      : `${subject} in ${businessName} on Meroidea.`;
    // Names and details stay inside the workspace (rules/security.md): the email only says what
    // kind of thing is waiting, and links to it.
    const result = await sendEmail({
      to,
      subject: many ? `${subject} (${items.length})` : subject,
      ...renderEmail({
        sender: { kind: 'platform' },
        preheader: intro,
        heading: subject,
        blocks: [
          { type: 'paragraph', text: intro },
          { type: 'button', label: `Open ${many ? 'them' : 'it'} in Meroidea`, url: link },
        ],
        reason: `You received this because you have a login in ${businessName} on Meroidea.`,
      }),
    });
    // Not set up is not a failure to retry: nothing would change on the next run.
    if (!result.sent && result.reason === 'failed') failed.push(...items);
  }
  return { failed };
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
