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
    const limited = isRateLimited(response.status, code);
    throw new ProviderError(
      platform,
      limited
        ? 'The platform is limiting how often we can call it.'
        : (safeReason(error?.message) ?? `The service refused the request (${response.status}).`),
      {
        reconnect: !limited && (response.status === 401 || code === 190),
        rateLimited: limited,
        retryAfterMinutes: limited ? minutesUntilAllowed(response.headers) : null,
        code,
      },
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

/**
 * Meta's throttling codes (developers.facebook.com, Graph API rate limiting): 4 app, 17 user,
 * 32 Page, 613 custom, and 80000–80014 per business use case (80006 Messenger, 80002 Instagram,
 * 80007 WhatsApp); WhatsApp's 130429 (the number's throughput) and 131056 (too many messages to
 * one customer in a short time). An HTTP 429 from anyone means the same.
 */
export function isRateLimited(status: number, code: unknown): boolean {
  if (status === 429) return true;
  const value = typeof code === 'string' ? Number(code) : code;
  return (
    typeof value === 'number' &&
    ([4, 17, 32, 613, 130429, 131056].includes(value) || (value >= 80000 && value <= 80014))
  );
}

/**
 * How long Meta says to wait, from `X-Business-Use-Case-Usage`
 * (`estimated_time_to_regain_access`, in minutes); the longest wait wins. Null when not stated.
 */
export function minutesUntilAllowed(headers: Headers): number | null {
  const raw = headers.get('x-business-use-case-usage');
  if (!raw || raw.length > 10_000) return null;
  try {
    const usage = JSON.parse(raw) as Record<
      string,
      { estimated_time_to_regain_access?: unknown }[]
    >;
    let longest: number | null = null;
    for (const entries of Object.values(usage)) {
      for (const entry of Array.isArray(entries) ? entries : []) {
        const minutes = entry.estimated_time_to_regain_access;
        if (typeof minutes === 'number' && minutes > 0) longest = Math.max(longest ?? 0, minutes);
      }
    }
    return longest;
  } catch {
    return null;
  }
}
