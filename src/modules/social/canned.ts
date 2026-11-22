/**
 * Saved replies' placeholders (ADR-068), filled in when one is put into the reply box. Unknown
 * placeholders are left as typed, so a mistake shows instead of vanishing; a known one with no
 * value (a customer whose name we do not have) becomes empty.
 */
export type CannedValues = {
  contactFirstName: string | null;
  contactName: string | null;
  agentName: string | null;
};

export const CANNED_PLACEHOLDERS = [
  { token: '{{contact.first_name}}', label: 'Customer’s first name' },
  { token: '{{contact.name}}', label: 'Customer’s full name' },
  { token: '{{agent.name}}', label: 'Your name' },
] as const;

export function renderCannedReply(body: string, values: CannedValues): string {
  const known: Record<string, string | null> = {
    'contact.first_name': values.contactFirstName,
    'contact.name': values.contactName,
    'agent.name': values.agentName,
  };
  return body
    .replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, (whole, key: string) =>
      key in known ? (known[key] ?? '') : whole,
    )
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

/** The saved replies whose shortcut or title starts with, or contains, what was typed. */
export function findCanned<T extends { title: string; shortcut: string | null }>(
  replies: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return replies;
  const starts = replies.filter(
    (reply) => reply.shortcut?.startsWith(q) || reply.title.toLowerCase().startsWith(q),
  );
  const contains = replies.filter(
    (reply) =>
      !starts.includes(reply) &&
      (reply.shortcut?.includes(q) || reply.title.toLowerCase().includes(q)),
  );
  return [...starts, ...contains];
}
