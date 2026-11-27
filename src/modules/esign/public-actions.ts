'use server';

import { cookies, headers } from 'next/headers';

import { AppError, toActionError, type ActionResult } from '@/lib/errors';
import { clientAddress } from '@/server/request';

import {
  declineSigning,
  sendSigningCode,
  SESSION_HOURS,
  submitSignature,
  verifySignedDocument,
  verifySigningCode,
  type VerifiedDocument,
} from './public';
import {
  declineSchema,
  signerTokenSchema,
  submitSignatureSchema,
  verifyCodeSchema,
  verifyDocumentSchema,
} from './schemas';

/*
 * Called from the signing page by someone who is not signed in. The link's secret, carried in the
 * input, is the credential, plus the session cookie set after a right code; ./public.ts checks
 * both before doing anything.
 */

async function requestMeta() {
  const list = await headers();
  return { ip: clientAddress(list), userAgent: list.get('user-agent') };
}

async function cookieReader() {
  const store = await cookies();
  return (name: string) => store.get(name)?.value;
}

async function run<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    if (!(error instanceof AppError) && !(error instanceof Error && error.name === 'ZodError')) {
      console.error('[esign] failed', { name: error instanceof Error ? error.name : typeof error });
    }
    return { ok: false, error: toActionError(error) };
  }
}

export async function sendSigningCodeAction(raw: unknown): Promise<ActionResult<null>> {
  return run(async () => {
    await sendSigningCode(signerTokenSchema.parse(raw).token, await requestMeta());
    return null;
  });
}

export async function verifySigningCodeAction(raw: unknown): Promise<ActionResult<null>> {
  return run(async () => {
    const input = verifyCodeSchema.parse(raw);
    const session = await verifySigningCode(input.token, input.code, await requestMeta());
    (await cookies()).set(session.cookieName, session.secret, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_HOURS * 3600,
    });
    return null;
  });
}

export async function submitSignatureAction(
  raw: unknown,
): Promise<ActionResult<{ completed: boolean }>> {
  return run(async () =>
    submitSignature(submitSignatureSchema.parse(raw), await cookieReader(), await requestMeta()),
  );
}

export async function declineSigningAction(raw: unknown): Promise<ActionResult<null>> {
  return run(async () => {
    await declineSigning(declineSchema.parse(raw), await cookieReader(), await requestMeta());
    return null;
  });
}

export async function verifySignedDocumentAction(
  raw: unknown,
): Promise<ActionResult<VerifiedDocument | null>> {
  return run(async () =>
    verifySignedDocument(verifyDocumentSchema.parse(raw).sha256, await requestMeta()),
  );
}
