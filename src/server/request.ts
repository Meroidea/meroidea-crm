import 'server-only';

import { isIP } from 'node:net';

import { NextResponse } from 'next/server';

import { AppError, toActionError } from '@/lib/errors';

/** Thrown when a public request's body is larger than its route accepts. */
export class PayloadTooLargeError extends Error {
  constructor() {
    super('Payload too large');
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * Reads at most `maxBytes` of a request body. The Content-Length header is only a hint: a
 * chunked request has none, and a dishonest one can understate it, so the limit is enforced on
 * the bytes as they arrive and reading stops the moment it is crossed.
 */
export async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) throw new PayloadTooLargeError();
  if (!request.body) return new Uint8Array(new ArrayBuffer(0));

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** A JSON object body, capped at `maxBytes`. Anything else is a validation error. */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const bytes = await readBodyWithLimit(request, maxBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AppError('VALIDATION', 'That could not be read. Try again.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AppError('VALIDATION', 'That could not be read. Try again.');
  }
  return parsed as Record<string, unknown>;
}

/** A multipart or url-encoded form body, capped at `maxBytes` before it is parsed. */
export async function readFormBody(request: Request, maxBytes: number): Promise<FormData> {
  const bytes = await readBodyWithLimit(request, maxBytes);
  const contentType = request.headers.get('content-type') ?? '';
  try {
    return await new Response(bytes, { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw new AppError('VALIDATION', 'That could not be read. Try again.');
  }
}

/**
 * The sender's address: hashed for rate limiting, and kept in the audit row of a contract
 * acceptance. On Vercel the platform sets these headers itself and overwrites what the client
 * sent, so they can be trusted there. Behind another proxy, make sure it does the same.
 */
export function clientAddress(headers: Headers): string | null {
  // Only a well-formed address is used: these values end up in an `inet` audit column.
  const first = (value: string | null) => {
    const candidate = value?.split(',')[0]?.trim();
    return candidate && isIP(candidate) ? candidate : null;
  };
  return (
    first(headers.get('x-vercel-forwarded-for')) ??
    first(headers.get('x-real-ip')) ??
    first(headers.get('x-forwarded-for'))
  );
}

/** The JSON answer every public intake route gives for a failure, with a matching status. */
export function publicErrorResponse(error: unknown): NextResponse {
  if (error instanceof PayloadTooLargeError) {
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION', message: 'That is too large to send.' } },
      { status: 413 },
    );
  }
  const mapped = toActionError(error);
  const status =
    mapped.code === 'NOT_FOUND'
      ? 404
      : mapped.code === 'RATE_LIMITED'
        ? 429
        : mapped.code === 'INTERNAL'
          ? 500
          : 400;
  return NextResponse.json({ ok: false, error: mapped }, { status });
}
