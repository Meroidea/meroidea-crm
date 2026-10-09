'use server';

import { headers } from 'next/headers';

import { AppError, toActionError, type ActionResult } from '@/lib/errors';

import { acceptOffer, declineOffer, submitPayrollDetails } from './public';
import { acceptOfferSchema, declineOfferSchema, payrollDetailsSchema } from './schemas';

/*
 * Called from the one-time link page by someone who is not signed in. The link's secret, carried
 * in the input, is the credential; ./public.ts verifies it before doing anything.
 */

async function requestMeta() {
  const list = await headers();
  return {
    ip: list.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    userAgent: list.get('user-agent'),
  };
}

async function run(work: () => Promise<void>): Promise<ActionResult<null>> {
  try {
    await work();
    return { ok: true, data: null };
  } catch (error) {
    if (!(error instanceof AppError) && !(error instanceof Error && error.name === 'ZodError')) {
      console.error('[offer] failed', { name: error instanceof Error ? error.name : typeof error });
    }
    return { ok: false, error: toActionError(error) };
  }
}

export async function acceptOfferAction(raw: unknown): Promise<ActionResult<null>> {
  return run(async () => acceptOffer(acceptOfferSchema.parse(raw), await requestMeta()));
}

export async function declineOfferAction(raw: unknown): Promise<ActionResult<null>> {
  return run(async () => declineOffer(declineOfferSchema.parse(raw).token, await requestMeta()));
}

export async function submitPayrollDetailsAction(raw: unknown): Promise<ActionResult<null>> {
  return run(async () =>
    submitPayrollDetails(payrollDetailsSchema.parse(raw), await requestMeta()),
  );
}
