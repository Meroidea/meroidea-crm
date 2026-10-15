'use server';

import { headers } from 'next/headers';

import { AppError, toActionError, type ActionResult } from '@/lib/errors';
import { findWorkspaceForUser, provisionTenant } from '@/modules/tenants/provision';
import { consumeRateLimit, enforceRateLimit, rateLimitReached } from '@/server/rate-limit';
import { clientAddress } from '@/server/request';
import { createSupabaseServerClient } from '@/server/supabase/server';

import { signInSchema, signUpSchema } from './schemas';

/**
 * Creates the account and provisions its workspace. Sign-up is open on the marketing site
 * (ADR-021); inside an existing workspace, people join by invitation instead.
 */
export async function signUpAction(raw: unknown): Promise<ActionResult<{ slug: string }>> {
  try {
    // Businesses are onboarded from the platform console now (ADR-029). The action stays so the
    // rule is enforced at the endpoint, not just by removing the form.
    if (process.env.ALLOW_PUBLIC_SIGNUP !== 'true') {
      throw new AppError(
        'FORBIDDEN',
        'New workspaces are set up by Meroidea. Please get in touch.',
      );
    }
    const input = signUpSchema.parse(raw);
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { full_name: input.fullName } },
    });

    if (error) {
      // Never reveal whether an address is already registered beyond what Supabase already says.
      const code = error.status === 429 ? 'CONFLICT' : 'VALIDATION';
      throw new AppError(code, error.message);
    }
    if (!data.user) throw new AppError('INTERNAL', 'Could not create your account.');

    // Idempotent: a repeated submission must not provision a second workspace.
    if (await findWorkspaceForUser(data.user.id)) return { ok: true, data: { slug: '' } };

    const workspace = await provisionTenant({
      userId: data.user.id,
      companyName: input.companyName,
    });

    return { ok: true, data: { slug: workspace.slug } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/**
 * Sign-in limits. Supabase's own per-address limit sees this server, not the person, so it would
 * either let one guesser try without end or lock everyone out at once. Wrong passwords are
 * counted per account and sender together, so a guesser locks out only themselves, never the
 * account's real owner; a much higher count per account alone stops guessing spread across
 * many senders. Every attempt is also counted per sender, which stops one sender trying many
 * accounts.
 */
const SIGN_IN_WINDOW_SECONDS = 15 * 60;
const SIGN_IN_FAILURES_PER_ACCOUNT_AND_SENDER = 10;
const SIGN_IN_FAILURES_PER_ACCOUNT = 100;
const SIGN_IN_ATTEMPTS_PER_ADDRESS = 40;
const SIGN_IN_LIMITED = 'Too many sign-in attempts. Wait 15 minutes and try again.';

export async function signInAction(raw: unknown): Promise<ActionResult<null>> {
  try {
    const input = signInSchema.parse(raw);
    const address = clientAddress(await headers());
    // Unknown addresses (no proxy header) are not counted together: that would be one shared
    // counter for everyone.
    if (address) {
      await enforceRateLimit(
        {
          bucket: 'sign-in:address',
          subject: address,
          limit: SIGN_IN_ATTEMPTS_PER_ADDRESS,
          windowSeconds: SIGN_IN_WINDOW_SECONDS,
        },
        SIGN_IN_LIMITED,
      );
    }
    const account = input.email.toLowerCase();
    const failureLimits = [
      {
        bucket: 'sign-in:account-sender',
        subject: `${account}|${address ?? 'unknown'}`,
        limit: SIGN_IN_FAILURES_PER_ACCOUNT_AND_SENDER,
        windowSeconds: SIGN_IN_WINDOW_SECONDS,
      },
      {
        bucket: 'sign-in:account',
        subject: account,
        limit: SIGN_IN_FAILURES_PER_ACCOUNT,
        windowSeconds: SIGN_IN_WINDOW_SECONDS,
      },
    ];
    for (const limit of failureLimits) {
      if (await rateLimitReached(limit)) throw new AppError('RATE_LIMITED', SIGN_IN_LIMITED);
    }

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (error) {
      for (const limit of failureLimits) await consumeRateLimit(limit);
      // Deliberately vague: never disclose whether the address exists.
      throw new AppError('UNAUTHENTICATED', 'That email and password do not match.');
    }

    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

export async function signOutAction(): Promise<ActionResult<null>> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return { ok: true, data: null };
}
