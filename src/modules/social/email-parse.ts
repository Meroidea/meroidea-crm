/*
 * Reading and writing email for the inbox (ADR-070), without a mail library: addresses, the
 * words of a message without the quoted history, subjects, the thread's reply address, and
 * whether a message was sent by a machine. Pure functions, tested in tests/unit.
 */

import { randomInt } from 'node:crypto';

const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/**
 * A thread's secret reply-address token: 24 characters, about 124 bits, each drawn uniformly
 * (`randomInt`, not `byte % 36`, which favours the first four characters).
 */
export function newReplyToken(): string {
  return Array.from({ length: 24 }, () => TOKEN_ALPHABET[randomInt(36)]).join('');
}

const ADDRESS = /^[^\s@<>"(),;:]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/** "Sam Lee <Sam@Example.com>" → { name: "Sam Lee", email: "sam@example.com" }. */
export function parseAddress(raw: string | null | undefined): {
  name: string | null;
  email: string | null;
} {
  const value = (raw ?? '').trim();
  const angled = /^(.*?)<([^<>]+)>\s*$/.exec(value);
  const email = (angled ? angled[2]! : value).trim().toLowerCase();
  const name = angled
    ? angled[1]!
        .trim()
        .replace(/^"(.*)"$/, '$1')
        .replace(/\\"/g, '"')
        .trim() || null
    : null;
  return { name: name?.slice(0, 120) ?? null, email: ADDRESS.test(email) ? email : null };
}

export function isEmailAddress(value: string): boolean {
  return ADDRESS.test(value);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Plain words from an HTML email, for messages sent without a text part. The result is shown
 * as text, never as HTML, so nothing in it can run.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === '#') {
        const point =
          code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(point) && point > 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : '';
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Where the earlier conversation starts in a reply: "On … wrote:", a forwarded block, or "> ". */
const QUOTE_STARTS = [
  /^On .{4,200}wrote:\s*$/im,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^_{10,}\s*$/m,
  /^From: .+\n(Sent|Date): .+$/im,
];

/**
 * A reply's own words, without the history mail programs quote below it. Keeps everything when
 * the reply would otherwise be empty (a forwarded message, or a reply typed inline).
 */
export function stripQuotedReply(text: string): string {
  const normalised = text.replace(/\r\n/g, '\n');
  let cut = normalised.length;
  for (const pattern of QUOTE_STARTS) {
    const match = pattern.exec(normalised);
    if (match && match.index < cut) cut = match.index;
  }
  // A trailing block of "> " lines.
  const lines = normalised.slice(0, cut).split('\n');
  while (lines.length > 0 && /^\s*(>.*)?$/.test(lines[lines.length - 1]!)) lines.pop();
  const own = lines.join('\n').trim();
  return own || normalised.trim();
}

/** "Order 1042" → "Re: Order 1042"; an existing Re: or Fwd: chain is kept as one Re:. */
export function replySubject(subject: string | null): string {
  const base = (subject ?? '').replace(/^(\s*(re|fwd?|aw|sv)\s*:\s*)+/i, '').trim();
  return base ? `Re: ${base}`.slice(0, 200) : 'Re: your message';
}

/** The local part that marks a thread's own reply address: r-<24 lower-case letters/digits>. */
const REPLY_LOCAL = /^r-([a-z0-9]{24})$/;

export function replyAddress(token: string, domain: string): string {
  return `r-${token}@${domain}`;
}

/** The thread token in any of these addresses at the inbox domain, or null. */
export function replyTokenIn(addresses: string[], domain: string): string | null {
  for (const raw of addresses) {
    const { email } = parseAddress(raw);
    if (!email) continue;
    const at = email.lastIndexOf('@');
    if (email.slice(at + 1) !== domain) continue;
    const match = REPLY_LOCAL.exec(email.slice(0, at));
    if (match) return match[1]!;
  }
  return null;
}

/** Message-IDs from an In-Reply-To or References header, in order, without duplicates. */
export function messageIds(header: string | null | undefined): string[] {
  const found = (header ?? '').match(/<[^<>\s]{3,250}>/g) ?? [];
  return [...new Set(found)];
}

/**
 * Whether a message was sent by a machine (an auto-reply, a bounce, a mailing list), from its
 * headers and sender. Such messages are kept, but never become a lead or open a ticket.
 */
export function isAutomated(headers: Record<string, string>, from: string | null): boolean {
  const auto = (headers['auto-submitted'] ?? '').trim().toLowerCase();
  if (auto && auto !== 'no') return true;
  if (/^(bulk|junk|list|auto_reply)$/i.test((headers['precedence'] ?? '').trim())) return true;
  if (headers['x-autoreply'] || headers['x-autorespond'] || headers['list-id']) return true;
  if (headers['x-auto-response-suppress']?.match(/all|oof|autoreply/i)) return true;
  const local = (from ?? '').split('@')[0] ?? '';
  return /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?)$/i.test(local);
}

/** A business's inbox address local part: 3-40 lower-case letters, digits, dots and dashes. */
export const INBOX_LOCAL_PART = /^[a-z0-9](?:[a-z0-9.-]{1,38}[a-z0-9])$/;

/** Local parts no business may take: the platform's own and the reply addresses. */
export function reservedLocalPart(local: string): boolean {
  return (
    /^r-/.test(local) ||
    /\.\.|\.-|-\./.test(local) ||
    [
      'abuse',
      'admin',
      'administrator',
      'billing',
      'hostmaster',
      'info',
      'mailer-daemon',
      'noreply',
      'no-reply',
      'postmaster',
      'root',
      'security',
      'support',
      'webmaster',
    ].includes(local)
  );
}
