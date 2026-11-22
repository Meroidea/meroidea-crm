import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import {
  socialAccounts,
  socialCannedResponses,
  socialConversations,
  socialMessages,
} from '@/db/schema';
import { AppError } from '@/lib/errors';
import { audit } from '@/server/audit';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { AccountSettingsInput, CannedResponseInput, NoteInput } from './schemas';
import { readAccountSettings } from './settings';

/*
 * Working on the inbox as a team (ADR-068): private notes, saved replies, and how each account
 * treats senders who match no contact. What anyone wrote never goes into the audit log.
 */

function pgCode(error: unknown): string | undefined {
  const own = (error as { code?: string }).code;
  return own ?? (error as { cause?: { code?: string } }).cause?.code;
}

/**
 * A private note on a conversation, for colleagues only. It sits in the thread among the
 * messages but is never sent, never moves the conversation's last message or reply window, and
 * never reaches a customer-facing page. Allowed whatever the platform's reply window says.
 */
export async function addNote(
  ctx: TenantContext,
  input: NoteInput,
  now = new Date(),
): Promise<{ messageId: string }> {
  requirePermission(ctx, 'social.reply');
  return withRls(ctx, async (tx) => {
    const [conversation] = await tx
      .select({ id: socialConversations.id, accountId: socialConversations.accountId })
      .from(socialConversations)
      .where(
        and(
          eq(socialConversations.tenantId, ctx.tenantId),
          eq(socialConversations.id, input.conversationId),
        ),
      )
      .limit(1);
    if (!conversation) throw new AppError('NOT_FOUND', 'That conversation was not found.');
    const [note] = await tx
      .insert(socialMessages)
      .values({
        tenantId: ctx.tenantId,
        conversationId: conversation.id,
        accountId: conversation.accountId,
        direction: 'note',
        body: input.body,
        sentAt: now,
        sentByUserId: ctx.userId,
        status: 'sent',
      })
      .returning({ id: socialMessages.id });
    if (!note) throw new AppError('INTERNAL', 'The note could not be saved.');
    await audit(tx, ctx, {
      action: 'create',
      entityType: 'social_note',
      entityId: note.id,
      context: { conversationId: conversation.id },
    });
    return { messageId: note.id };
  });
}

/** Whether new leads are made for unknown senders on this account, and with which source. */
export async function setAccountSettings(
  ctx: TenantContext,
  input: AccountSettingsInput,
): Promise<void> {
  requirePermission(ctx, 'social.manage');
  await withRls(ctx, async (tx) => {
    const [account] = await tx
      .select({ id: socialAccounts.id, settings: socialAccounts.settings })
      .from(socialAccounts)
      .where(and(eq(socialAccounts.tenantId, ctx.tenantId), eq(socialAccounts.id, input.accountId)))
      .limit(1);
    if (!account) throw new AppError('NOT_FOUND', 'That account was not found.');
    const before = readAccountSettings(account.settings);
    const after = {
      createLeadForUnknown: input.createLeadForUnknown,
      leadSourceId: input.leadSourceId,
      // Left out: kept as they are, so changing one setting never resets another.
      autoTicket: input.autoTicket ?? before.autoTicket,
      autoTicketPriority: input.autoTicketPriority ?? before.autoTicketPriority,
    };
    try {
      await tx.execute(
        sql`select app.social_set_account_settings(${account.id}::uuid, ${JSON.stringify(after)}::jsonb)`,
      );
    } catch (error) {
      const code = pgCode(error);
      if (code === 'P0002') throw new AppError('NOT_FOUND', 'That account is no longer connected.');
      if (code === '22023') {
        throw new AppError('VALIDATION', 'Choose one of your lead sources.', {
          leadSourceId: ['Choose one of your lead sources.'],
        });
      }
      throw error;
    }
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'social_account',
      entityId: account.id,
      changes: {
        createLeadForUnknown: [before.createLeadForUnknown, after.createLeadForUnknown],
        leadSourceId: [before.leadSourceId, after.leadSourceId],
        autoTicket: [before.autoTicket, after.autoTicket],
        autoTicketPriority: [before.autoTicketPriority, after.autoTicketPriority],
      },
    });
  });
}

/**
 * Creates or changes a saved reply. A shared one needs social.canned_manage; a person's own needs
 * only social.reply. The database enforces the same (RLS on social_canned_responses).
 */
export async function saveCannedResponse(
  ctx: TenantContext,
  input: CannedResponseInput,
): Promise<{ id: string }> {
  requirePermission(ctx, 'social.reply');
  if (input.shared) requirePermission(ctx, 'social.canned_manage');
  const ownerUserId = input.shared ? null : ctx.userId;
  return withRls(ctx, async (tx) => {
    try {
      if (!input.id) {
        const [created] = await tx
          .insert(socialCannedResponses)
          .values({
            tenantId: ctx.tenantId,
            ownerUserId,
            title: input.title,
            shortcut: input.shortcut,
            body: input.body,
            createdBy: ctx.userId,
            updatedBy: ctx.userId,
          })
          .returning({ id: socialCannedResponses.id });
        if (!created) throw new AppError('INTERNAL', 'The reply could not be saved.');
        await audit(tx, ctx, {
          action: 'create',
          entityType: 'social_canned_response',
          entityId: created.id,
          changes: { title: [null, input.title], shared: [null, input.shared] },
        });
        return { id: created.id };
      }
      // RLS shows a person only shared replies and their own.
      const [existing] = await tx
        .select({
          id: socialCannedResponses.id,
          ownerUserId: socialCannedResponses.ownerUserId,
          title: socialCannedResponses.title,
        })
        .from(socialCannedResponses)
        .where(
          and(
            eq(socialCannedResponses.tenantId, ctx.tenantId),
            eq(socialCannedResponses.id, input.id),
          ),
        )
        .limit(1);
      if (!existing) throw new AppError('NOT_FOUND', 'That saved reply was not found.');
      if (existing.ownerUserId === null) requirePermission(ctx, 'social.canned_manage');
      await tx
        .update(socialCannedResponses)
        .set({
          ownerUserId,
          title: input.title,
          shortcut: input.shortcut,
          body: input.body,
          updatedBy: ctx.userId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(socialCannedResponses.tenantId, ctx.tenantId),
            eq(socialCannedResponses.id, existing.id),
          ),
        );
      await audit(tx, ctx, {
        action: 'update',
        entityType: 'social_canned_response',
        entityId: existing.id,
        changes: {
          title: [existing.title, input.title],
          shared: [existing.ownerUserId === null, input.shared],
        },
      });
      return { id: existing.id };
    } catch (error) {
      if (pgCode(error) === '23505') {
        const message = 'Another saved reply already uses that shortcut.';
        throw new AppError('DUPLICATE', message, { shortcut: [message] });
      }
      throw error;
    }
  });
}

export async function deleteCannedResponse(ctx: TenantContext, id: string): Promise<void> {
  requirePermission(ctx, 'social.reply');
  await withRls(ctx, async (tx) => {
    const [existing] = await tx
      .select({ id: socialCannedResponses.id, ownerUserId: socialCannedResponses.ownerUserId })
      .from(socialCannedResponses)
      .where(
        and(eq(socialCannedResponses.tenantId, ctx.tenantId), eq(socialCannedResponses.id, id)),
      )
      .limit(1);
    if (!existing) throw new AppError('NOT_FOUND', 'That saved reply was not found.');
    if (existing.ownerUserId === null && !hasPermission(ctx, 'social.canned_manage')) {
      throw new AppError(
        'FORBIDDEN',
        'Only people who manage saved replies can delete shared ones.',
      );
    }
    await tx
      .delete(socialCannedResponses)
      .where(
        and(eq(socialCannedResponses.tenantId, ctx.tenantId), eq(socialCannedResponses.id, id)),
      );
    await audit(tx, ctx, {
      action: 'delete',
      entityType: 'social_canned_response',
      entityId: id,
    });
  });
}
