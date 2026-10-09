import 'server-only';

import { revalidatePath } from 'next/cache';
import type { z } from 'zod';

import { AppError, toActionError, type ActionResult } from '@/lib/errors';
import type { PermissionKey } from '@/lib/permissions/catalog';
import { getTenantContext, requirePermission, type TenantContext } from '@/server/context';

type ActionOptions<S extends z.ZodType> = {
  /** Checked at any scope here; the service checks the record's scope. */
  permission: PermissionKey | null;
  input: S;
  revalidate?: string[];
};

/**
 * Server Actions are public HTTP endpoints, so every one goes through this wrapper:
 * authenticate → tenant context → permission → Zod parse → service → map errors
 * (docs/architecture.md §3). The service owns scope, business rules, transaction and audit.
 */
export function authedAction<S extends z.ZodType, T>(
  options: ActionOptions<S>,
  handler: (ctx: TenantContext, input: z.infer<S>) => Promise<T>,
): (raw: unknown) => Promise<ActionResult<T>> {
  return async (raw: unknown) => {
    try {
      const ctx = await getTenantContext();
      if (!ctx) throw new AppError('UNAUTHENTICATED', 'Please sign in again.');
      if (ctx.tenant.status === 'suspended' && !ctx.isSupport) {
        throw new AppError('FORBIDDEN', 'This workspace is suspended.');
      }
      if (options.permission) requirePermission(ctx, options.permission);
      const input = options.input.parse(raw);
      const data = await handler(ctx, input);
      for (const path of options.revalidate ?? []) revalidatePath(path, 'layout');
      return { ok: true, data };
    } catch (error) {
      // Driver errors echo query parameters (personal data): log only the kind of failure.
      if (!(error instanceof AppError)) console.error('[action] failed', describeError(error));
      return { ok: false, error: toActionError(error) };
    }
  };
}

function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: typeof error };
  const cause = (error as { cause?: { code?: unknown; constraint_name?: unknown } }).cause;
  return { name: error.name, code: cause?.code, constraint: cause?.constraint_name };
}
