'use server';

import { headers } from 'next/headers';

import { AppError, toActionError, type ActionResult } from '@/lib/errors';
import { createPasswordLink } from '@/modules/access/service';
import { clientAddress } from '@/server/request';

import { acceptAgreement } from './agreement-public';
import { acceptAgreementSchema } from './schemas';

/**
 * Called from the agreement's one-time page by a business admin who cannot sign in yet. The
 * link's secret, carried in the input, is the credential; ./agreement-public.ts verifies it.
 * On success the admin is handed a one-time link to choose their password, the same one used
 * for every first sign-in (ADR-031).
 */
export async function acceptAgreementAction(
  raw: unknown,
): Promise<ActionResult<{ passwordLink: string | null }>> {
  try {
    const input = acceptAgreementSchema.parse(raw);
    const list = await headers();
    const { email } = await acceptAgreement(input, {
      ip: clientAddress(list),
      userAgent: list.get('user-agent'),
    });
    // Null only if the auth server could not issue it; the page then points to "Forgot password".
    return { ok: true, data: { passwordLink: await createPasswordLink(email) } };
  } catch (error) {
    if (!(error instanceof AppError) && !(error instanceof Error && error.name === 'ZodError')) {
      console.error('[agreement] failed', {
        name: error instanceof Error ? error.name : typeof error,
      });
    }
    return { ok: false, error: toActionError(error) };
  }
}
