'use server';

import { cookies } from 'next/headers';

import { AppError } from '@/lib/errors';
import { authedAction } from '@/server/action';
import { serverEnv } from '@/server/env';

import { createOAuthState, OAUTH_COOKIE } from './oauth-state';
import { metaAuthorizeUrl, metaConfigured } from './providers/meta';
import { tiktokAuthorizeUrl, tiktokConfigured } from './providers/tiktok';
import {
  accountIdSchema,
  conversationIdSchema,
  conversationStatusSchema,
  linkContactSchema,
  replySchema,
  startConnectSchema,
} from './schemas';
import * as social from './service';

const paths = ['/social'];

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
