'use server';

import { AppError, toActionError, type ActionResult } from '@/lib/errors';
import { findWorkspaceForUser, provisionTenant } from '@/modules/tenants/provision';
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

export async function signInAction(raw: unknown): Promise<ActionResult<null>> {
  try {
    const input = signInSchema.parse(raw);
    const supabase = await createSupabaseServerClient();

    const { error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    // Deliberately vague: never disclose whether the address exists.
    if (error) throw new AppError('UNAUTHENTICATED', 'That email and password do not match.');

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
