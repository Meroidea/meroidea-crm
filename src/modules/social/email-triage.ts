import 'server-only';

import { and, eq } from 'drizzle-orm';

import { emailSenderRules, socialAccounts, socialConversations } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

/*
 * Sorting the Email area (ADR-073). A sender marked "Not a customer" leaves To review for
 * Filtered, now and with later emails, which are still received and kept. Moving them back undoes
 * it. The audit row names the thread, never the address.
 */

async function emailThread(tx: Tx, ctx: TenantContext, conversationId: string) {
  const [thread] = await tx
    .select({
      id: socialConversations.id,
      email: socialConversations.participantEmail,
      contactId: socialConversations.contactId,
    })
    .from(socialConversations)
    .innerJoin(
      socialAccounts,
      and(
        eq(socialAccounts.tenantId, socialConversations.tenantId),
        eq(socialAccounts.id, socialConversations.accountId),
      ),
    )
    .where(
      and(
        eq(socialConversations.tenantId, ctx.tenantId),
        eq(socialConversations.id, conversationId),
        eq(socialAccounts.platform, 'email'),
      ),
    )
    .limit(1);
  if (!thread?.email) throw new AppError('NOT_FOUND', 'That email thread was not found.');
  return { ...thread, email: thread.email };
}

/** Marks an email thread's sender "Not a customer". A sender linked to a contact cannot be. */
export async function markNotCustomer(ctx: TenantContext, conversationId: string): Promise<void> {
  requirePermission(ctx, 'social.reply');
  await withRls(ctx, async (tx) => {
    const thread = await emailThread(tx, ctx, conversationId);
    if (thread.contactId) {
      throw new AppError(
        'CONFLICT',
        'This sender is linked to a contact. Unlink them first if they are not a customer.',
      );
    }
    const [created] = await tx
      .insert(emailSenderRules)
      .values({ tenantId: ctx.tenantId, email: thread.email, createdBy: ctx.userId })
      .onConflictDoNothing({ target: [emailSenderRules.tenantId, emailSenderRules.email] })
      .returning({ id: emailSenderRules.id });
    if (created) {
      await audit(tx, ctx, {
        action: 'create',
        entityType: 'email_sender_rule',
        entityId: created.id,
        context: { conversationId: thread.id, kind: 'not_customer' },
      });
    }
  });
}

/** Moves a sender back out of Filtered: their threads show in To review (or Customers) again. */
export async function moveSenderBack(ctx: TenantContext, conversationId: string): Promise<void> {
  requirePermission(ctx, 'social.reply');
  await withRls(ctx, async (tx) => {
    const thread = await emailThread(tx, ctx, conversationId);
    const gone = await tx
      .delete(emailSenderRules)
      .where(
        and(eq(emailSenderRules.tenantId, ctx.tenantId), eq(emailSenderRules.email, thread.email)),
      )
      .returning({ id: emailSenderRules.id });
    for (const rule of gone) {
      await audit(tx, ctx, {
        action: 'delete',
        entityType: 'email_sender_rule',
        entityId: rule.id,
        context: { conversationId: thread.id },
      });
    }
  });
}
