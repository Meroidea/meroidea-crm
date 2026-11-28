'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';

import { AppError } from '@/lib/errors';
import { authedAction } from '@/server/action';
import { serverEnv } from '@/server/env';

import { createOAuthState, OAUTH_COOKIE } from './oauth-state';
import { metaAuthorizeUrl, metaConfigured } from './providers/meta';
import { tiktokAuthorizeUrl, tiktokConfigured } from './providers/tiktok';
import {
  emailImportantSchema,
  emailThreadsSchema,
  accountIdSchema,
  accountSettingsInputSchema,
  assignSchema,
  cannedResponseIdSchema,
  cannedResponseSchema,
  connectWhatsAppSchema,
  conversationIdSchema,
  conversationStatusSchema,
  emailInboxSchema,
  createTemplateSchema,
  linkContactSchema,
  mediaReplySchema,
  mediaUploadSchema,
  messageIdSchema,
  composeEmailSchema,
  composeUploadPathSchema,
  addressQuerySchema,
  composeUploadSchema,
  draftIdSchema,
  emailDraftSchema,
  emailReplySchema,
  emailSignatureSchema,
  noteSchema,
  replySchema,
  senderRuleSchema,
  snoozeSchema,
  startConnectSchema,
  templateIdSchema,
  templateReplySchema,
} from './schemas';
import * as bin from './bin-service';
import * as compose from './compose-service';
import * as email from './email-service';
import * as triage from './email-triage';
import { chatWidgetSchema } from './livechat-schemas';
import * as livechat from './livechat-service';
import * as social from './service';
import * as team from './team-service';
import * as whatsapp from './whatsapp-service';

// The Social inbox and Email share conversations and their actions (ADR-073).
const paths = ['/social', '/email'];

/**
 * Starts connecting accounts: a one-time state goes in an http-only cookie and the browser is
 * sent to Meta or TikTok to log in. The callback (src/app/api/social/oauth) finishes it.
 */
export const startConnectAction = authedAction(
  { permission: 'social.manage', input: startConnectSchema },
  async (ctx, input) => {
    const configured = input.provider === 'meta' ? metaConfigured() : tiktokConfigured();
    if (!configured) {
      throw new AppError(
        'CONFLICT',
        `${input.provider === 'meta' ? 'Facebook and Instagram' : 'TikTok'} are not set up on this platform yet. Ask the platform owner.`,
      );
    }
    const { state, cookie } = createOAuthState(input.provider, ctx.tenantId, ctx.userId);
    const redirectUri = `${serverEnv().APP_URL}/api/social/oauth/${input.provider}`;
    (await cookies()).set(OAUTH_COOKIE, cookie, {
      httpOnly: true,
      secure: serverEnv().APP_URL.startsWith('https://'),
      // Lax, because the login provider brings the browser back with a top-level redirect.
      sameSite: 'lax',
      path: `/api/social/oauth/${input.provider}`,
      maxAge: 600,
    });
    return {
      url:
        input.provider === 'meta'
          ? metaAuthorizeUrl(state, redirectUri)
          : tiktokAuthorizeUrl(state),
    };
  },
);

export const disconnectAccountAction = authedAction(
  { permission: 'social.manage', input: accountIdSchema, revalidate: paths },
  (ctx, input) => social.disconnectAccount(ctx, input.accountId),
);

export const replyAction = authedAction(
  { permission: 'social.reply', input: replySchema, revalidate: paths },
  (ctx, input) => social.replyToConversation(ctx, input),
);

/** An email written in Compose (ADR-089, ADR-090); opens its own thread. */
export const sendComposedEmailAction = authedAction(
  { permission: 'social.reply', input: composeEmailSchema, revalidate: paths },
  (ctx, input) => social.startEmailConversation(ctx, input),
);

/** Saves the email being written as a draft (ADR-091): the writer's own, autosaved. */
export const saveDraftAction = authedAction(
  { permission: 'social.reply', input: emailDraftSchema },
  (ctx, input) => compose.saveDraft(ctx, input),
);

/** Discards a draft and the files it held. */
export const discardDraftAction = authedAction(
  { permission: 'social.reply', input: draftIdSchema, revalidate: paths },
  (ctx, input) => compose.deleteDraft(ctx, input.id, { removeFiles: true }),
);

/** Contacts matching what is typed in To, Cc or Bcc (ADR-091); within the person's scope. */
export const suggestAddressesAction = authedAction(
  { permission: 'social.reply', input: addressQuerySchema },
  (ctx, input) => compose.suggestAddresses(ctx, input.q),
);

/** A formatted email reply, with Cc, Bcc, files and pictures (ADR-091). */
export const emailReplyAction = authedAction(
  { permission: 'social.reply', input: emailReplySchema, revalidate: paths },
  (ctx, input) => social.replyWithEmail(ctx, input),
);

/** Saves the person's own email signature (ADR-091). */
export const saveSignatureAction = authedAction(
  { permission: 'social.reply', input: emailSignatureSchema, revalidate: paths },
  (ctx, input) => compose.saveSignature(ctx, input),
);

/** A ticket to upload one file for an email being composed (ADR-090). */
export const startComposeUploadAction = authedAction(
  { permission: 'social.reply', input: composeUploadSchema },
  (ctx, input) => social.startComposeUpload(ctx, input),
);

/** Takes a file off an email being composed, before it is sent. */
export const removeComposeUploadAction = authedAction(
  { permission: 'social.reply', input: composeUploadPathSchema },
  (ctx, input) => social.removeComposeUpload(ctx, input.path),
);

export const retryReplyAction = authedAction(
  { permission: 'social.reply', input: messageIdSchema, revalidate: paths },
  (ctx, input) => social.retryReply(ctx, input.messageId),
);

export const linkContactAction = authedAction(
  { permission: 'social.reply', input: linkContactSchema, revalidate: paths },
  (ctx, input) => social.linkConversationContact(ctx, input),
);

export const setConversationStatusAction = authedAction(
  { permission: 'social.reply', input: conversationStatusSchema, revalidate: paths },
  (ctx, input) => social.setConversationStatus(ctx, input),
);

export const markReadAction = authedAction(
  { permission: 'social.view', input: conversationIdSchema },
  (ctx, input) => social.markConversationRead(ctx, input.conversationId),
);

/** Finishes connecting a WhatsApp number after Embedded Signup returned its code (ADR-066). */
export const connectWhatsAppAction = authedAction(
  { permission: 'social.manage', input: connectWhatsAppSchema, revalidate: paths },
  (ctx, input) => whatsapp.connectWhatsApp(ctx, input),
);

export const templateReplyAction = authedAction(
  { permission: 'social.reply', input: templateReplySchema, revalidate: paths },
  (ctx, input) => social.sendTemplateReply(ctx, input),
);

export const refreshTemplatesAction = authedAction(
  { permission: 'social.manage', input: accountIdSchema, revalidate: paths },
  (ctx, input) => whatsapp.refreshTemplates(ctx, input.accountId),
);

export const createTemplateAction = authedAction(
  { permission: 'social.manage', input: createTemplateSchema, revalidate: paths },
  (ctx, input) => whatsapp.createTemplate(ctx, input),
);

export const deleteTemplateAction = authedAction(
  { permission: 'social.manage', input: templateIdSchema, revalidate: paths },
  (ctx, input) => whatsapp.deleteTemplate(ctx, input.templateId),
);

/** Gives a conversation to a colleague, or back to the team (ADR-067). */
export const assignAction = authedAction(
  { permission: 'social.reply', input: assignSchema, revalidate: paths },
  (ctx, input) => social.assignConversation(ctx, input),
);

export const snoozeAction = authedAction(
  { permission: 'social.reply', input: snoozeSchema, revalidate: paths },
  (ctx, input) => social.snoozeConversation(ctx, input),
);

/** A one-time upload ticket for a reply's attachment, at a path the server chooses. */
export const startMediaUploadAction = authedAction(
  { permission: 'social.reply', input: mediaUploadSchema },
  (ctx, input) => social.startMediaUpload(ctx, input),
);

export const mediaReplyAction = authedAction(
  { permission: 'social.reply', input: mediaReplySchema, revalidate: paths },
  (ctx, input) => social.sendMediaReply(ctx, input),
);

/** Whether an account makes new leads for senders who match no contact (ADR-068). */
export const accountSettingsAction = authedAction(
  {
    permission: 'social.manage',
    input: accountSettingsInputSchema,
    revalidate: ['/social/accounts'],
  },
  (ctx, input) => team.setAccountSettings(ctx, input),
);

/** A private note for colleagues; never sent to the customer (ADR-068). */
export const noteAction = authedAction(
  { permission: 'social.reply', input: noteSchema, revalidate: paths },
  (ctx, input) => team.addNote(ctx, input),
);

export const saveCannedResponseAction = authedAction(
  { permission: 'social.reply', input: cannedResponseSchema, revalidate: paths },
  (ctx, input) => team.saveCannedResponse(ctx, input),
);

export const deleteCannedResponseAction = authedAction(
  { permission: 'social.reply', input: cannedResponseIdSchema, revalidate: paths },
  (ctx, input) => team.deleteCannedResponse(ctx, input.id),
);

/** Creates an email inbox for the business (ADR-070). */
export const createEmailInboxAction = authedAction(
  { permission: 'social.manage', input: emailInboxSchema, revalidate: paths },
  (ctx, input) => email.createEmailInbox(ctx, input),
);

/** Creates a live chat widget; its identity secret is in the answer this once (ADR-072). */
export const createChatWidgetAction = authedAction(
  { permission: 'social.manage', input: chatWidgetSchema, revalidate: ['/social/accounts'] },
  (ctx, input) => livechat.createChatWidget(ctx, input),
);

export const updateChatWidgetAction = authedAction(
  {
    permission: 'social.manage',
    input: chatWidgetSchema.required({ accountId: true }),
    revalidate: ['/social/accounts'],
  },
  (ctx, input) => livechat.updateChatWidget(ctx, input),
);

export const rotateChatIdentitySecretAction = authedAction(
  { permission: 'social.manage', input: accountIdSchema },
  (ctx, input) => livechat.rotateChatIdentitySecret(ctx, input.accountId),
);

/** Email (ADR-073): a sender who is not a customer moves to Filtered, with later emails. */
export const markNotCustomerAction = authedAction(
  { permission: 'social.reply', input: senderRuleSchema, revalidate: paths },
  (ctx, input) => triage.markNotCustomer(ctx, input.conversationId),
);

export const moveSenderBackAction = authedAction(
  { permission: 'social.reply', input: senderRuleSchema, revalidate: paths },
  (ctx, input) => triage.moveSenderBack(ctx, input.conversationId),
);

/* Bin and Important (ADR-093). */

/** Deletes email threads to the Bin, where they stay restorable for 30 days. */
export const binEmailAction = authedAction(
  { permission: 'social.reply', input: emailThreadsSchema, revalidate: paths },
  (ctx, input) => bin.binEmailThreads(ctx, input),
);

export const restoreEmailAction = authedAction(
  { permission: 'social.reply', input: emailThreadsSchema, revalidate: paths },
  (ctx, input) => bin.restoreEmailThreads(ctx, input),
);

export const importantEmailAction = authedAction(
  { permission: 'social.reply', input: emailImportantSchema, revalidate: paths },
  (ctx, input) => bin.setEmailImportant(ctx, input),
);

/** Deletes email threads in the Bin for good, now. Cannot be undone. */
export const purgeEmailAction = authedAction(
  { permission: 'social.manage', input: emailThreadsSchema, revalidate: paths },
  (ctx, input) => bin.purgeEmailThreads(ctx, input),
);

export const emptyEmailBinAction = authedAction(
  { permission: 'social.manage', input: z.object({}), revalidate: paths },
  (ctx) => bin.emptyEmailBin(ctx),
);
