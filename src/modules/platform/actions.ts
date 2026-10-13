'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import { AppError, toActionError, type ActionResult } from '@/lib/errors';
import { reencryptPayrollDetails } from '@/modules/hiring/key-rotation';
import { ACTIVE_TENANT_COOKIE } from '@/server/context';
import { assertPlatformAdmin, type PlatformAdmin } from '@/server/platform';

import {
  createBusinessSchema,
  setFeaturesSchema,
  setLocationSchema,
  setStatusSchema,
  tenantIdSchema,
} from './schemas';
import * as platformService from './service';

/** Every platform action checks the caller is a platform owner before anything else. */
async function platformAction<T>(
  work: (admin: PlatformAdmin) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const data = await work(await assertPlatformAdmin());
    revalidatePath('/platform', 'layout');
    return { ok: true, data };
  } catch (error) {
    if (!(error instanceof AppError) && !(error instanceof Error && error.name === 'ZodError')) {
      console.error('[platform] failed', {
        name: error instanceof Error ? error.name : typeof error,
      });
    }
    return { ok: false, error: toActionError(error) };
  }
}

export async function createBusinessAction(raw: unknown) {
  return platformAction((admin) =>
    platformService.createBusiness(admin, createBusinessSchema.parse(raw)),
  );
}

export async function setBusinessFeaturesAction(raw: unknown) {
  return platformAction((admin) =>
    platformService.setBusinessFeatures(admin, setFeaturesSchema.parse(raw)),
  );
}

export async function setBusinessStatusAction(raw: unknown) {
  return platformAction((admin) =>
    platformService.setBusinessStatus(admin, setStatusSchema.parse(raw)),
  );
}

export async function setBusinessLocationAction(raw: unknown) {
  return platformAction((admin) =>
    platformService.setBusinessLocation(admin, setLocationSchema.parse(raw)),
  );
}

/** Moves every stored payroll number onto the current encryption key (ADR-040). */
export async function reencryptPayrollDetailsAction() {
  return platformAction((admin) => reencryptPayrollDetails(admin));
}

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: process.env.NODE_ENV === 'production',
} as const;

export async function startSupportAccessAction(raw: unknown) {
  return platformAction(async (admin) => {
    const { tenantId } = tenantIdSchema.parse(raw);
    await platformService.startSupportAccess(admin, tenantId);
    (await cookies()).set(ACTIVE_TENANT_COOKIE, tenantId, cookieOptions);
    return null;
  });
}

/** Leaves the business being supported and returns the owner to their own workspace. */
export async function endSupportAccessAction(raw: unknown) {
  return platformAction(async (admin) => {
    const { tenantId } = tenantIdSchema.parse(raw);
    await platformService.endSupportAccess(admin, tenantId);
    (await cookies()).delete(ACTIVE_TENANT_COOKIE);
    return null;
  });
}
