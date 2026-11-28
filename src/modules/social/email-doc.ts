import { z } from 'zod';

import { escapeHtml } from '@/lib/html';

/*
 * A formatted email (ADR-090) as a small document, not HTML. The editor in the browser turns
 * what was typed into this shape; the server checks it with Zod and writes the HTML itself, with
 * every character escaped and only these formats possible. HTML from the browser is never
 * trusted, so nothing a person types or pastes can put a script, a tracking pixel or a hidden
 * form into an email.
 *
 * Colours are email content, not the app's theme: they are written into the email as inline
 * styles, the only styling mail programs reliably keep (ADR-053).
 */

export const EMAIL_COLORS = {
  black: '#1f2328',
  gray: '#6e7781',
  red: '#cf222e',
  orange: '#bc4c00',
  green: '#1a7f37',
  blue: '#0969da',
  purple: '#8250df',
} as const;
export const EMAIL_HIGHLIGHTS = {
  yellow: '#fff3a3',
  green: '#d2f5d8',
  blue: '#d6ecff',
  pink: '#ffdde0',
} as const;
export const EMAIL_SIZES = { small: '13px', normal: '15px', large: '19px', huge: '26px' } as const;

export type EmailColor = keyof typeof EMAIL_COLORS;
export type EmailHighlight = keyof typeof EMAIL_HIGHLIGHTS;
export type EmailSize = keyof typeof EMAIL_SIZES;

const colorKeys = Object.keys(EMAIL_COLORS) as [EmailColor, ...EmailColor[]];
const highlightKeys = Object.keys(EMAIL_HIGHLIGHTS) as [EmailHighlight, ...EmailHighlight[]];
const sizeKeys = Object.keys(EMAIL_SIZES) as [EmailSize, ...EmailSize[]];

/** The longest an email's words can be, all blocks together. */
export const EMAIL_MAX_TEXT = 20_000;

/** A link a mail program can open safely: web or email addresses only. */
export function safeHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2000) return null;
  try {
    const url = new URL(trimmed);
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) return null;
    if (url.protocol !== 'mailto:' && !url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

const inlineSchema = z.strictObject({
  text: z.string().max(EMAIL_MAX_TEXT),
  b: z.literal(true).optional(),
  i: z.literal(true).optional(),
  u: z.literal(true).optional(),
  s: z.literal(true).optional(),
  color: z.enum(colorKeys).optional(),
  bg: z.enum(highlightKeys).optional(),
  size: z.enum(sizeKeys).optional(),
  href: z
    .string()
    .max(2000)
    .refine(
      (value) => safeHref(value) !== null,
      'Links must start with https://, http:// or mailto:',
    )
    .optional(),
});
export type EmailInline = z.output<typeof inlineSchema>;

const align = z.enum(['left', 'center', 'right']).optional();
const content = z.array(inlineSchema).max(500);

const blockSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('paragraph'), align, content }),
  z.strictObject({
    type: z.literal('heading'),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    align,
    content,
  }),
  z.strictObject({ type: z.literal('quote'), content }),
  z.strictObject({
    type: z.literal('list'),
    ordered: z.boolean(),
    items: z.array(content).min(1).max(200),
  }),
  z.strictObject({ type: z.literal('rule') }),
]);
export type EmailBlock = z.output<typeof blockSchema>;

export const emailDocSchema = z
  .array(blockSchema)
  .max(1000)
  .refine((doc) => emailDocText(doc).length <= EMAIL_MAX_TEXT, 'That email is too long')
  .refine((doc) => emailDocText(doc).trim().length > 0, 'Write your email first');
export type EmailDoc = z.output<typeof blockSchema>[];

/* ------------------------------------------------------------------------------- text */

function inlineText(items: EmailInline[]): string {
  return items
    .map((item) => {
      if (!item.href) return item.text;
      const href = item.href.replace(/^mailto:/, '');
      return item.text.trim() === href || item.text.trim() === item.href
        ? item.text
        : `${item.text} (${href})`;
    })
    .join('');
}

/**
 * The email as plain text: the text part every email carries (ADR-053), and what search, the
 * thread list and notifications read.
 */
export function emailDocText(doc: EmailDoc): string {
  return doc
    .map((block) => {
      switch (block.type) {
        case 'paragraph':
        case 'heading':
          return inlineText(block.content);
        case 'quote':
          return inlineText(block.content)
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n');
        case 'list':
          return block.items
            .map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${inlineText(item)}`)
            .join('\n');
        case 'rule':
          return '---';
      }
    })
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------------------------------------- HTML */

function inlineHtml(items: EmailInline[]): string {
  return items
    .map((item) => {
      let html = escapeHtml(item.text).replace(/\r?\n/g, '<br>');
      if (!html) return '';
      const styles = [
        item.color && `color:${EMAIL_COLORS[item.color]}`,
        item.bg && `background-color:${EMAIL_HIGHLIGHTS[item.bg]}`,
        item.size && item.size !== 'normal' && `font-size:${EMAIL_SIZES[item.size]}`,
      ].filter(Boolean);
      if (item.b) html = `<strong>${html}</strong>`;
      if (item.i) html = `<em>${html}</em>`;
      if (item.u) html = `<u>${html}</u>`;
      if (item.s) html = `<s>${html}</s>`;
      if (styles.length > 0) html = `<span style="${styles.join(';')}">${html}</span>`;
      const href = item.href ? safeHref(item.href) : null;
      if (href) {
        html = `<a href="${escapeHtml(href)}" style="color:${EMAIL_COLORS.blue}" target="_blank" rel="noopener noreferrer">${html}</a>`;
      }
      return html;
    })
    .join('');
}

const alignStyle = (value: 'left' | 'center' | 'right' | undefined) =>
  value && value !== 'left' ? `;text-align:${value}` : '';

const HEADING_SIZES = { 1: '26px', 2: '21px', 3: '17px' } as const;

/**
 * The email's HTML, built only from the checked document: tables-free, inline styles, no images
 * and no scripts, as ADR-053's layout does for Meroidea's own emails.
 */
export function emailDocHtml(doc: EmailDoc): string {
  const blocks = doc
    .map((block) => {
      switch (block.type) {
        case 'paragraph': {
          const inner = inlineHtml(block.content);
          return `<p style="margin:0 0 12px${alignStyle(block.align)}">${inner || '<br>'}</p>`;
        }
        case 'heading':
          return `<p style="margin:16px 0 8px;font-weight:600;font-size:${HEADING_SIZES[block.level]};line-height:1.3${alignStyle(block.align)}">${inlineHtml(block.content)}</p>`;
        case 'quote':
          return `<blockquote style="margin:0 0 12px;padding:4px 0 4px 12px;border-left:3px solid #d0d7de;color:#57606a">${inlineHtml(block.content)}</blockquote>`;
        case 'list': {
          const tag = block.ordered ? 'ol' : 'ul';
          const items = block.items
            .map((item) => `<li style="margin:0 0 4px">${inlineHtml(item)}</li>`)
            .join('');
          return `<${tag} style="margin:0 0 12px;padding-left:24px">${items}</${tag}>`;
        }
        case 'rule':
          return '<hr style="border:0;border-top:1px solid #d0d7de;margin:16px 0">';
      }
    })
    .join('');
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2328">${blocks}</div>`;
}

/** A plain text body as a document: one paragraph per line, as replies are written. */
export function textToEmailDoc(text: string): EmailDoc {
  return text
    .split(/\r?\n\r?\n/)
    .map((part) => ({ type: 'paragraph' as const, content: [{ text: part }] }));
}

/** What `social_messages.email_outbound` holds (ADR-090): recipients and the document. */
export type StoredCompose = { to: string[]; cc: string[]; bcc: string[]; doc: EmailDoc };

const storedComposeSchema = z.object({
  to: z.array(z.string().max(254)).max(100).default([]),
  cc: z.array(z.string().max(254)).max(100).default([]),
  bcc: z.array(z.string().max(254)).max(100).default([]),
  doc: emailDocSchema,
});

/**
 * A stored composed email, checked again when read: the screen renders the document as React
 * elements, and only a document that still passes the schema. Recipients may have been erased
 * (an erased person's thread keeps the words, not the addresses).
 */
export function readStoredCompose(value: unknown): StoredCompose | null {
  const parsed = storedComposeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
