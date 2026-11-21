import 'server-only';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { AppError, toActionError } from '@/lib/errors';
import { getTenantContext, workspaceClosedReason, type TenantContext } from '@/server/context';
import { isSameOrigin, PayloadTooLargeError } from '@/server/request';

const STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export function jsonOk<T>(data: T): NextResponse {
  return NextResponse.json({ ok: true, data }, { headers: NO_STORE });
}

/**
 * The signed-in Route Handler equivalent of authedAction(), for the few endpoints that cannot be
 * Server Actions (ADR-063, ADR-064): same-origin check → authenticate → tenant context →
 * workspace open, then the handler, which checks its permission and parses its input. Errors come
 * back as `{ ok: false, error }` with a matching status; unknown ones are logged by kind only.
 */
export async function authedRoute(
  request: Request,
  handler: (ctx: TenantContext) => Promise<Response>,
): Promise<Response> {
  try {
    if (!isSameOrigin(request.headers)) throw new AppError('FORBIDDEN', 'Not allowed.');
    const ctx = await getTenantContext();
    if (!ctx) throw new AppError('UNAUTHENTICATED', 'Please sign in again.');
    if (workspaceClosedReason(ctx)) throw new AppError('FORBIDDEN', 'This workspace is closed.');
    return await handler(ctx);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION', message: 'That is too large to send.' } },
        { status: 413, headers: NO_STORE },
      );
    }
    if (!(error instanceof AppError) && !(error instanceof z.ZodError)) {
      console.error('[route] failed', error instanceof Error ? error.name : 'unknown');
    }
    const mapped = toActionError(error);
    return NextResponse.json(
      { ok: false, error: mapped },
      { status: STATUS[mapped.code] ?? 400, headers: NO_STORE },
    );
  }
}

const idSchema = z.uuid();

/** A route's `[id]` segment, as a uuid or a not-found that reveals nothing. */
export async function routeId(params: Promise<{ id: string }>): Promise<string> {
  const parsed = idSchema.safeParse((await params).id);
  if (!parsed.success) throw new AppError('NOT_FOUND', 'That was not found.');
  return parsed.data;
}
