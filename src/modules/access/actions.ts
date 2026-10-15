'use server';

import { headers } from 'next/headers';

import { AppError, toActionError, type ActionResult } from '@/lib/errors';
import { authedAction } from '@/server/action';
import { isEmailConfigured } from '@/server/email';
import { consumeRateLimit, enforceRateLimit } from '@/server/rate-limit';
import { clientAddress } from '@/server/request';
import { createSupabaseServerClient } from '@/server/supabase/server';

import {
  forgotPasswordSchema,
  inviteMemberSchema,
  memberSchema,
  memberStatusSchema,
  setPasswordSchema,
} from './schemas';
import * as accessService from './service';

const PATHS = ['/settings', '/staff'];
const manage = { permission: 'users.manage', revalidate: PATHS } as const;

export const inviteMemberAction = authedAction(
  { ...manage, input: inviteMemberSchema },
  (ctx, input) => accessService.inviteMember(ctx, input),
);
export const sendPasswordLinkAction = authedAction(
  { ...manage, input: memberSchema },
  (ctx, input) => accessService.sendPasswordLink(ctx, input.userId),
);
export const setMemberStatusAction = authedAction(
  { ...manage, input: memberStatusSchema },
  (ctx, input) => accessService.setMemberStatus(ctx, input),
);

/** Public: anyone can ask. The reply never reveals whether the address has a login. */
export async function requestPasswordResetAction(
  raw: unknown,
): Promise<ActionResult<{ emailAvailable: boolean }>> {
  try {
    const { email } = forgotPasswordSchema.parse(raw);
    const address = clientAddress(await headers());
    if (address) {
      await enforceRateLimit(
        { bucket: 'password-reset:address', subject: address, limit: 10, windowSeconds: 3600 },
        'Too many requests. Wait an hour and try again.',
      );
    }
    // A few links an hour per address at most, so nobody can flood someone's inbox. Past that,
    // the answer stays the same, so it never shows whether the address has a login.
    const withinLimit = await consumeRateLimit({
      bucket: 'password-reset:email',
      subject: email.toLowerCase(),
      limit: 3,
      windowSeconds: 3600,
    });
    if (withinLimit) await accessService.requestPasswordReset(email);
    return { ok: true, data: { emailAvailable: isEmailConfigured() } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/** Sets the signed-in person's own password: after following a link, or to change it. */
export async function setPasswordAction(raw: unknown): Promise<ActionResult<null>> {
  try {
    const { password } = setPasswordSchema.parse(raw);
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError('UNAUTHENTICATED', 'That link has expired. Ask for a new one.');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new AppError('VALIDATION', error.message, { password: [error.message] });
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
