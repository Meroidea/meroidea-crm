import { NextResponse } from 'next/server';

import { AppError, toActionError } from '@/lib/errors';
import { assistantChatSchema, ASSISTANT_LIMITS } from '@/modules/assistant/schemas';
import { streamAssistantReply } from '@/modules/assistant/service';
import { getTenantContext, workspaceClosedReason } from '@/server/context';
import { isSameOrigin, PayloadTooLargeError, readJsonBody } from '@/server/request';

/** Room for a few tool calls and a streamed answer on a slow model. */
export const maxDuration = 60;

const STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/**
 * The AI assistant's chat endpoint (ADR-063). A Route Handler rather than a Server Action
 * because the answer streams; it applies the same order as authedAction(): same-origin →
 * authenticate → tenant context → workspace open → permission → size-capped Zod parse. The
 * service then checks the permission again, rate-limits, and runs read-only tools under RLS.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    if (!isSameOrigin(request.headers)) throw new AppError('FORBIDDEN', 'Not allowed.');

    const ctx = await getTenantContext();
    if (!ctx) throw new AppError('UNAUTHENTICATED', 'Please sign in again.');
    if (workspaceClosedReason(ctx)) throw new AppError('FORBIDDEN', 'This workspace is closed.');

    const input = assistantChatSchema.parse(
      await readJsonBody(request, ASSISTANT_LIMITS.maxBodyBytes),
    );
    return await streamAssistantReply(ctx, input, request.signal);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json(
        { ok: false, error: { code: 'VALIDATION', message: 'That conversation is too long.' } },
        { status: 413 },
      );
    }
    if (!(error instanceof AppError) && !(error instanceof Error && error.name === 'ZodError')) {
      console.error('[assistant] request failed', error instanceof Error ? error.name : 'unknown');
    }
    const mapped = toActionError(error);
    return NextResponse.json(
      { ok: false, error: mapped },
      { status: STATUS[mapped.code] ?? 400, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
