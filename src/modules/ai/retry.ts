/**
 * Retrying calls to the model (ADR-073). Pure, so the backoff can be tested without the network.
 *
 * Gemini answers 429 when a rate limit or quota is used up, and 503 when the model is overloaded.
 * Both are worth a short wait. A 429 often says how long to wait (`retryDelay`); when that is
 * longer than we are willing to hold a person's request, the limit is a daily quota and waiting
 * cannot help, so we give up at once instead of keeping them on a spinner.
 */

export type RetryOptions = {
  /** Retries after the first attempt. */
  retries: number;
  baseDelayMs: number;
  /** The longest single wait; a server asking for longer is treated as "not today". */
  maxDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  /** 0 ≤ random() < 1, for jitter. */
  random?: () => number;
};

export const MODEL_RETRY: RetryOptions = { retries: 2, baseDelayMs: 1_000, maxDelayMs: 8_000 };

const RETRYABLE = new Set([429, 503]);

/** The HTTP status of an error from the SDK (`ApiError.status`), or null. */
export function errorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

export function isRetryable(error: unknown): boolean {
  const status = errorStatus(error);
  return status !== null && RETRYABLE.has(status);
}

/**
 * The wait Google asked for, in milliseconds. Its error body carries a RetryInfo detail such as
 * `"retryDelay": "37s"`; the SDK puts that body in the error's message.
 */
export function serverRetryDelayMs(error: unknown): number | null {
  const message = error instanceof Error ? error.message : '';
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message);
  return match?.[1] ? Math.round(Number(match[1]) * 1000) : null;
}

/** Exponential backoff with jitter: base·2^attempt, scaled into [50%, 100%). */
export function backoffDelayMs(attempt: number, options: RetryOptions): number {
  const random = options.random ?? Math.random;
  const exponential = options.baseDelayMs * 2 ** attempt;
  return Math.min(options.maxDelayMs, Math.round(exponential * (0.5 + random() * 0.5)));
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withBackoff<T>(
  run: (attempt: number) => Promise<T>,
  options: RetryOptions = MODEL_RETRY,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run(attempt);
    } catch (error) {
      if (!isRetryable(error) || attempt >= options.retries) throw error;
      const asked = serverRetryDelayMs(error);
      if (asked !== null && asked > options.maxDelayMs) throw error;
      await sleep(Math.max(asked ?? 0, backoffDelayMs(attempt, options)));
    }
  }
}
