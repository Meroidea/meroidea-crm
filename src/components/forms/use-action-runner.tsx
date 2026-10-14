'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; fieldErrors?: Record<string, string[]> } };

/**
 * Runs a Server Action from a client form: shows its first field error or message, and on
 * success calls `after` and refreshes the page's server data.
 */
export function useActionRunner() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const run = <T,>(action: () => Promise<Result<T>>, after?: (data: T) => void) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) {
        setError(Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message);
        return;
      }
      after?.(result.data);
      router.refresh();
    });
  return { run, error, isPending, setError };
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? (
    <p
      role="alert"
      className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
    >
      {error}
    </p>
  ) : null;
}
