import 'server-only';

import type { SQL } from 'drizzle-orm';

import { AppError } from '@/lib/errors';
import type { Tx } from '@/server/db/with-rls';

/**
 * Runs one of the `app.ledger_*` functions and turns its refusals into errors people can read.
 * The messages are the function's own fixed wording, never the data it was given.
 */
export async function ledgerCall<T>(tx: Tx, query: SQL): Promise<T[]> {
  try {
    return (await tx.execute(query)) as unknown as T[];
  } catch (error) {
    throw toLedgerError(error);
  }
}

export function toLedgerError(error: unknown): unknown {
  const cause = (error as { cause?: { code?: string; message?: string } }).cause ?? error;
  const { code, message } = cause as { code?: string; message?: string };
  const text = message ?? '';
  switch (code) {
    case 'MB001':
      return new AppError('CONFLICT', `${text}. Ask the person who manages the books.`);
    case 'MB002':
      return new AppError('VALIDATION', text);
    case 'MB003':
      return new AppError('CONFLICT', text);
    case 'P0002':
      return new AppError('NOT_FOUND', text || 'That was not found.');
    case '42501':
      return new AppError('FORBIDDEN', 'You do not have access to that.');
    default:
      return error;
  }
}
