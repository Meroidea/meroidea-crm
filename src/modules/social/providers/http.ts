import 'server-only';

import { ProviderError, type SocialPlatform } from './types';

/**
 * One JSON call to a provider. Tokens travel in headers or bodies, never in the URL, so nothing
 * secret reaches a log line; errors carry the provider's code and a short reason only.
 */
export async function providerFetch(
  platform: SocialPlatform | 'meta',
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
      cache: 'no-store',
    });
  } catch {
    throw new ProviderError(platform, 'The service could not be reached. Try again shortly.');
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Some refusals have no JSON body; the status says enough.
  }
  if (!response.ok) {
    const error = (body as { error?: { message?: unknown; code?: unknown } } | null)?.error;
    const code =
      typeof error?.code === 'number' || typeof error?.code === 'string'
        ? error.code
        : response.status;
    throw new ProviderError(
      platform,
      safeReason(error?.message) ?? `The service refused the request (${response.status}).`,
      response.status === 401 || code === 190,
      code,
    );
  }
  return body;
}

/** A provider's own explanation, cut short and stripped of anything that looks like a token. */
export function safeReason(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value
    .replace(/[A-Za-z0-9_-]{40,}/g, '…')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
