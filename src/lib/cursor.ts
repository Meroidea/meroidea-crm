import { z } from 'zod';

/** Keyset pagination cursor over (created_at desc, id desc), opaque to the browser. */
const cursorSchema = z.object({ t: z.iso.datetime({ offset: true }), id: z.uuid() });

export type Cursor = { createdAt: Date; id: string };

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ t: row.createdAt.toISOString(), id: row.id })).toString(
    'base64url',
  );
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString()));
    return parsed.success ? { createdAt: new Date(parsed.data.t), id: parsed.data.id } : null;
  } catch {
    return null;
  }
}

/** Escapes LIKE wildcards so a search for "50%" means the characters, not a pattern. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
