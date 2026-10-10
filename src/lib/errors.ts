import { z } from 'zod';

export const APP_ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION',
  'CONFLICT',
  'DUPLICATE',
  /** Too many requests from one sender or to one public form; try again later. */
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export type FieldErrors = Record<string, string[]>;

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly fieldErrors?: FieldErrors,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export type ActionError = { code: AppErrorCode; message: string; fieldErrors?: FieldErrors };

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

/**
 * Maps anything thrown inside an action to a client-safe error. Unknown errors become INTERNAL
 * with a generic message: their text can contain SQL, stack details or personal data.
 */
export function toActionError(error: unknown): ActionError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
    };
  }
  if (error instanceof z.ZodError) {
    const fieldErrors: FieldErrors = {};
    for (const [field, messages] of Object.entries(z.flattenError(error).fieldErrors)) {
      if (Array.isArray(messages) && messages.length > 0) fieldErrors[field] = messages;
    }
    return { code: 'VALIDATION', message: 'Please check the highlighted fields.', fieldErrors };
  }
  return { code: 'INTERNAL', message: 'Something went wrong. Please try again.' };
}
