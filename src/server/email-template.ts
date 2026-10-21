import 'server-only';

import { escapeHtml } from '@/lib/html';
import { serverEnv } from '@/server/env';

/*
 * One layout for every email Meroidea sends, in HTML and plain text from the same blocks.
 *
 * Built for inboxes, not browsers: tables for layout, inline styles, no web fonts, no images (the
 * mark is drawn in HTML, so nothing is blocked or flagged as image-only), every link spelled out
 * in the text part, and the text part says the same as the HTML. Callers pass plain text only;
 * this file does all the escaping.
 *
 * Three looks:
 * - platform: from Meroidea itself (agreements, logins, alerts), signed by the Meroidea team;
 * - business: from a business on Meroidea to its customers, suppliers or staff (invoices,
 *   orders, rosters, offers, helpdesk replies), in the business's name and colour;
 * - personal: a person writing to a contact from the CRM, which should read like their own email.
 */

const BRAND = '#4b49ac';
const INK = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const CANVAS = '#f5f7ff';
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export type EmailBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'details'; rows: { label: string; value: string }[] }
  | {
      type: 'table';
      columns: string[];
      rows: string[][];
      /** Columns from this index on are right-aligned (numbers). */
      numericFrom?: number;
      totals?: { label: string; value: string; strong?: boolean }[];
      /** One line per row for the text part, when a row reads better as a sentence. */
      textRows?: string[];
      /** False keeps the totals out of the text part (an order's prices stay in the HTML). */
      totalsInText?: boolean;
    }
  /** Something a person wrote, kept as they wrote it (line breaks included). */
  | { type: 'message'; text: string }
  | { type: 'button'; label: string; url: string }
  | { type: 'note'; text: string };

export type EmailSender =
  | { kind: 'platform' }
  | { kind: 'business'; name: string; color?: string | null }
  | { kind: 'personal'; name: string; business: string };

export type EmailContent = {
  sender: EmailSender;
  /** The grey line inbox lists show after the subject. */
  preheader: string;
  heading?: string;
  blocks: EmailBlock[];
  /** Sign-off lines; defaults to the sender. */
  signature?: string[];
  /** Why the reader got this email, shown small at the bottom. */
  reason: string;
};

/** A business's own colour, only when it is a plain hex value; anything else could inject CSS. */
function safeColor(color: string | null | undefined): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : BRAND;
}

function siteHost(): string {
  try {
    return new URL(serverEnv().APP_URL).host;
  } catch {
    return 'meroidea.com';
  }
}

function defaultSignature(sender: EmailSender): string[] {
  if (sender.kind === 'platform') return ['The Meroidea team'];
  if (sender.kind === 'business') return [sender.name];
  return [sender.name, sender.business];
}

// pre-line keeps the writer's own line breaks (a sign-off over two lines) without odd spacing.
const paragraphStyle = `margin:0 0 16px;font-size:15px;line-height:24px;color:${INK};white-space:pre-line`;

function blockHtml(block: EmailBlock, accent: string): string {
  switch (block.type) {
    case 'paragraph':
      return `<p style="${paragraphStyle}">${escapeHtml(block.text)}</p>`;
    case 'note':
      return `<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:${MUTED}">${escapeHtml(block.text)}</p>`;
    case 'message':
      return `<div style="margin:0 0 20px;padding:14px 16px;border-left:3px solid ${accent};background:${CANVAS};border-radius:6px;font-size:15px;line-height:24px;color:${INK};white-space:pre-wrap">${escapeHtml(block.text)}</div>`;
    case 'list':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">${block.items
        .map(
          (item) =>
            `<tr><td width="20" valign="top" style="padding:6px 0;font-size:15px;line-height:22px;color:${accent}">&#9679;</td><td style="padding:6px 0;font-size:15px;line-height:22px;color:${INK};border-bottom:1px solid ${LINE}">${escapeHtml(item)}</td></tr>`,
        )
        .join('')}</table>`;
    case 'details':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:${CANVAS};border-radius:10px">${block.rows
        .map(
          (row) =>
            `<tr><td style="padding:10px 16px;font-size:13px;line-height:20px;color:${MUTED};width:38%" valign="top">${escapeHtml(row.label)}</td><td style="padding:10px 16px;font-size:14px;line-height:20px;color:${INK}" valign="top">${escapeHtml(row.value)}</td></tr>`,
        )
        .join('')}</table>`;
    case 'table': {
      const align = (index: number) =>
        block.numericFrom !== undefined && index >= block.numericFrom ? 'right' : 'left';
      const head = block.columns
        .map(
          (column, index) =>
            `<th align="${align(index)}" style="padding:8px 8px 8px 0;font-size:12px;line-height:16px;font-weight:600;color:${MUTED};text-transform:uppercase;letter-spacing:0.04em;border-bottom:2px solid ${LINE}">${escapeHtml(column)}</th>`,
        )
        .join('');
      const body = block.rows
        .map(
          (row) =>
            `<tr>${row
              .map(
                (cell, index) =>
                  `<td align="${align(index)}" style="padding:10px 8px 10px 0;font-size:14px;line-height:20px;color:${INK};border-bottom:1px solid ${LINE}">${escapeHtml(cell)}</td>`,
              )
              .join('')}</tr>`,
        )
        .join('');
      const totals = (block.totals ?? [])
        .map(
          (total) =>
            `<tr><td colspan="${block.columns.length - 1}" align="right" style="padding:8px 8px 0 0;font-size:14px;line-height:20px;color:${total.strong ? INK : MUTED};font-weight:${total.strong ? 700 : 400}">${escapeHtml(total.label)}</td><td align="right" style="padding:8px 8px 0 0;font-size:${total.strong ? 16 : 14}px;line-height:20px;color:${INK};font-weight:${total.strong ? 700 : 400}">${escapeHtml(total.value)}</td></tr>`,
        )
        .join('');
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-collapse:collapse"><thead><tr>${head}</tr></thead><tbody>${body}${totals}</tbody></table>`;
    }
    case 'button':
      // A "bulletproof" button: a link inside a coloured cell, so it shows in Outlook too, with
      // the address underneath for clients that strip buttons.
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 12px"><tr><td align="center" bgcolor="${accent}" style="border-radius:10px;background:${accent}"><a href="${escapeHtml(block.url)}" target="_blank" style="display:inline-block;padding:13px 26px;font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">${escapeHtml(block.label)} &rarr;</a></td></tr></table>
<p style="margin:0 0 20px;font-size:12px;line-height:18px;color:${MUTED};word-break:break-all">Or copy this link into your browser: <a href="${escapeHtml(block.url)}" style="color:${accent}">${escapeHtml(block.url)}</a></p>`;
  }
}

function blockText(block: EmailBlock): string {
  switch (block.type) {
    case 'paragraph':
    case 'note':
    case 'message':
      return block.text;
    case 'list':
      return block.items.map((item) => `- ${item}`).join('\n');
    case 'details':
      return block.rows.map((row) => `${row.label}: ${row.value}`).join('\n');
    case 'table':
      return [
        ...(block.textRows ?? block.rows.map((row) => row.join('  |  '))),
        ...(block.totalsInText === false ? [] : (block.totals ?? [])).map(
          (total) => `${total.label}: ${total.value}`,
        ),
      ].join('\n');
    case 'button':
      return `${block.label}: ${block.url}`;
  }
}

function headerHtml(sender: EmailSender, accent: string): string {
  if (sender.kind === 'personal') return '';
  const name = sender.kind === 'platform' ? 'Meroidea' : sender.name;
  const initial = escapeHtml((name.trim()[0] ?? 'M').toUpperCase());
  // The platform's mark carries its sky-blue "idea" dot; a business gets its own initial.
  const dot =
    sender.kind === 'platform'
      ? `<td width="8" valign="top" style="padding:0"><div style="width:8px;height:8px;border-radius:8px;background:#98bdff;margin-left:-6px"></div></td>`
      : '';
  return `<tr><td style="padding:28px 32px 0">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td width="36" height="36" align="center" valign="middle" bgcolor="${accent}" style="width:36px;height:36px;border-radius:10px;background:${accent};font-size:18px;line-height:36px;font-weight:700;color:#ffffff;font-family:${FONT}">${initial}</td>${dot}
<td style="padding-left:12px;font-size:17px;line-height:22px;font-weight:700;color:${INK};font-family:${FONT}">${escapeHtml(name)}</td>
</tr></table></td></tr>`;
}

export function renderEmail(content: EmailContent): { html: string; text: string } {
  const { sender } = content;
  const accent = sender.kind === 'business' ? safeColor(sender.color) : BRAND;
  const signature = content.signature ?? defaultSignature(sender);
  const host = siteHost();
  const footerLine =
    sender.kind === 'platform'
      ? `Meroidea · ${host}`
      : `Sent by ${sender.kind === 'business' ? sender.name : sender.business} with Meroidea · ${host}`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(content.heading ?? content.preheader)}</title></head>
<body style="margin:0;padding:0;background:${CANVAS};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(content.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${CANVAS}" style="background:${CANVAS}"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:16px;font-family:${FONT}">
${sender.kind === 'personal' ? '' : `<tr><td height="4" style="height:4px;line-height:4px;font-size:0;background:${accent};border-radius:16px 16px 0 0">&nbsp;</td></tr>`}
${headerHtml(sender, accent)}
<tr><td style="padding:${sender.kind === 'personal' ? '32px' : '24px'} 32px 8px">
${content.heading ? `<h1 style="margin:0 0 16px;font-size:22px;line-height:30px;font-weight:700;color:${INK};letter-spacing:-0.01em">${escapeHtml(content.heading)}</h1>` : ''}
${content.blocks.map((block) => blockHtml(block, accent)).join('\n')}
${signature.length ? `<p style="margin:8px 0 24px;font-size:15px;line-height:24px;color:${INK}">${signature.map((line, index) => (index === 0 ? `<strong>${escapeHtml(line)}</strong>` : `<span style="color:${MUTED}">${escapeHtml(line)}</span>`)).join('<br>')}</p>` : ''}
</td></tr>
<tr><td style="padding:18px 32px 24px;border-top:1px solid ${LINE}">
<p style="margin:0 0 6px;font-size:12px;line-height:18px;color:${MUTED}">${escapeHtml(content.reason)}</p>
<p style="margin:0;font-size:12px;line-height:18px;color:${MUTED}">${escapeHtml(footerLine)}</p>
</td></tr>
</table></td></tr></table>
</body></html>`;

  const text = [
    content.heading,
    ...content.blocks.map(blockText),
    signature.length ? signature.join('\n') : null,
    '---',
    content.reason,
    footerLine,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');

  return { html, text };
}
