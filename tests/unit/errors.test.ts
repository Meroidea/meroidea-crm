import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppError, toActionError } from '@/lib/errors';

describe('toActionError', () => {
  it('keeps the code, message and field errors of an AppError', () => {
    const error = new AppError('DUPLICATE', 'A contact with this email already exists.', {
      email: ['Already in use'],
    });

    expect(toActionError(error)).toEqual({
      code: 'DUPLICATE',
      message: 'A contact with this email already exists.',
      fieldErrors: { email: ['Already in use'] },
    });
  });

  it('turns a Zod error into VALIDATION with per-field messages', () => {
    const result = z.object({ email: z.email(), firstName: z.string().min(1) }).safeParse({
      email: 'not-an-email',
      firstName: '',
    });
    if (result.success) throw new Error('expected validation to fail');

    const actionError = toActionError(result.error);

    expect(actionError.code).toBe('VALIDATION');
    expect(Object.keys(actionError.fieldErrors ?? {}).sort()).toEqual(['email', 'firstName']);
  });

  it('never exposes the message of an unexpected error', () => {
    const leaky = new Error(
      'duplicate key value violates unique constraint "contacts_email" (jane@example.com)',
    );

    expect(toActionError(leaky)).toEqual({
      code: 'INTERNAL',
      message: 'Something went wrong. Please try again.',
    });
  });
});
