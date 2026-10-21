'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { AppError, toActionError, type ActionResult } from '@/lib/errors';
import { assertPlatformAdmin } from '@/server/platform';
import { clientAddress } from '@/server/request';

import { submitEnquiry } from './public';
import { setEnquiryStatusSchema, submitEnquirySchema } from './schemas';
import { setEnquiryStatus } from './service';

/** Public: the website's "Let's talk" form. Never says more than whether it was received. */
export async function submitEnquiryAction(raw: unknown): Promise<ActionResult<null>> {
  try {
    const input = submitEnquirySchema.parse(raw);
    await submitEnquiry(input, clientAddress(await headers()));
    return { ok: true, data: null };
  } catch (error) {
    if (!(error instanceof AppError) && !(error instanceof Error && error.name === 'ZodError')) {
      console.error('[enquiry] failed', { name: error instanceof Error ? error.name : 'unknown' });
    }
    return { ok: false, error: toActionError(error) };
  }
}

/** Platform owners only, checked before anything else. */
export async function setEnquiryStatusAction(raw: unknown): Promise<ActionResult<null>> {
  try {
    const admin = await assertPlatformAdmin();
    const input = setEnquiryStatusSchema.parse(raw);
    await setEnquiryStatus(admin, input.id, input.status);
    revalidatePath('/platform', 'layout');
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
