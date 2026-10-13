import { describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors';
import {
  clientAddress,
  PayloadTooLargeError,
  publicErrorResponse,
  readBodyWithLimit,
  readFormBody,
  readJsonBody,
} from '@/server/request';

/** A request whose body arrives in chunks with no Content-Length, as a chunked upload does. */
function chunked(parts: string[], headers: Record<string, string> = {}): Request {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new Request('http://localhost/api', {
    method: 'POST',
    body,
    headers,
    duplex: 'half',
  } as RequestInit);
}

describe('reading a public request body', () => {
  it('stops a chunked body with no Content-Length once it passes the limit', async () => {
    const request = chunked(['a'.repeat(600), 'b'.repeat(600)]);
    expect(request.headers.get('content-length')).toBeNull();
    await expect(readBodyWithLimit(request, 1000)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it('refuses early when the declared length is already too large', async () => {
    const request = new Request('http://localhost/api', {
      method: 'POST',
      body: 'x'.repeat(10),
      headers: { 'content-length': '5000' },
    });
    await expect(readBodyWithLimit(request, 1000)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it('reads a body within the limit, however it is chunked', async () => {
    const bytes = await readBodyWithLimit(chunked(['{"a":', '1}']), 1000);
    expect(new TextDecoder().decode(bytes)).toBe('{"a":1}');
  });

  it('accepts only a JSON object', async () => {
    expect(await readJsonBody(chunked(['{"rating":5}']), 100)).toEqual({ rating: 5 });
    for (const body of ['not json', '[1,2]', 'null', '"text"']) {
      const error = await readJsonBody(chunked([body]), 100).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('VALIDATION');
    }
  });

  it('parses a multipart form only after checking its size', async () => {
    const form = new FormData();
    form.set('fullName', 'Ada');
    const encoded = new Request('http://localhost/api', { method: 'POST', body: form });
    const contentType = encoded.headers.get('content-type')!;
    const raw = await encoded.text();

    const parsed = await readFormBody(chunked([raw], { 'content-type': contentType }), 10_000);
    expect(parsed.get('fullName')).toBe('Ada');
    await expect(
      readFormBody(chunked([raw], { 'content-type': contentType }), 10),
    ).rejects.toBeInstanceOf(PayloadTooLargeError);
  });
});

describe('the sender’s address', () => {
  it('prefers the platform’s own header and takes the first hop', () => {
    const headers = new Headers({
      'x-vercel-forwarded-for': '203.0.113.9',
      'x-forwarded-for': '198.51.100.1, 10.0.0.1',
    });
    expect(clientAddress(headers)).toBe('203.0.113.9');
    expect(clientAddress(new Headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).toBe(
      '198.51.100.1',
    );
    expect(clientAddress(new Headers({ 'x-real-ip': '2001:db8::1' }))).toBe('2001:db8::1');
  });

  it('ignores anything that is not an address', () => {
    expect(clientAddress(new Headers({ 'x-forwarded-for': "1.2.3.4'; drop table" }))).toBeNull();
    expect(clientAddress(new Headers())).toBeNull();
  });
});

describe('public error responses', () => {
  it('maps each failure to the right status', async () => {
    expect(publicErrorResponse(new PayloadTooLargeError()).status).toBe(413);
    expect(publicErrorResponse(new AppError('RATE_LIMITED', 'Slow down')).status).toBe(429);
    expect(publicErrorResponse(new AppError('NOT_FOUND', 'Gone')).status).toBe(404);
    expect(publicErrorResponse(new AppError('VALIDATION', 'Bad')).status).toBe(400);
    const internal = publicErrorResponse(new Error('select * from secrets'));
    expect(internal.status).toBe(500);
    expect(JSON.stringify(await internal.json())).not.toContain('secrets');
  });
});
