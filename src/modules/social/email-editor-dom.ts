import {
  EMAIL_COLORS,
  EMAIL_HIGHLIGHTS,
  safeHref,
  type EmailBlock,
  type EmailColor,
  type EmailDoc,
  type EmailHighlight,
  type EmailInline,
  type EmailSize,
} from './email-doc';

/*
 * The editor's contents → an email document (ADR-090). Runs in the browser on the editable
 * area. It reads only the formats the toolbar can make, from the tags and inline styles browsers
 * write for them, and drops everything else. The server checks the result again; this side only
 * decides what the person meant.
 *
 * Written against the few DOM members it needs, so it is tested without a browser.
 */

export type DomLike = {
  nodeType: number;
  nodeName: string;
  childNodes: ArrayLike<DomLike>;
  /** Text nodes. */
  data?: string;
  getAttribute?: (name: string) => string | null;
  style?: Partial<
    Pick<
      CSSStyleDeclaration,
      | 'fontWeight'
      | 'fontStyle'
      | 'textDecoration'
      | 'textDecorationLine'
      | 'color'
      | 'backgroundColor'
      | 'fontSize'
      | 'textAlign'
    >
  >;
};

const TEXT = 3;
const ELEMENT = 1;

type Marks = Omit<EmailInline, 'text'>;

/** "rgb(207, 34, 46)" or "#CF222E" → "#cf222e"; anything else → null. */
function hexOf(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/.test(raw)) {
    return `#${[...raw.slice(1)].map((char) => char + char).join('')}`;
  }
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(raw);
  if (!rgb) return null;
  if (rgb[4] !== undefined && Number(rgb[4]) === 0) return null;
  return `#${[rgb[1], rgb[2], rgb[3]]
    .map((part) => Math.min(255, Number(part)).toString(16).padStart(2, '0'))
    .join('')}`;
}

function paletteKey<K extends string>(palette: Record<K, string>, value: string | null) {
  const hex = hexOf(value);
  if (!hex) return undefined;
  return (Object.keys(palette) as K[]).find((key) => palette[key] === hex);
}

/** Browsers' font sizes (the 1–7 of `fontSize`, or CSS keywords) → the editor's four. */
function sizeOf(value: string | null | undefined): EmailSize | undefined {
  const raw = (value ?? '').trim().toLowerCase();
  if (['1', '2', 'x-small', 'small', 'xx-small'].includes(raw)) return 'small';
  if (['3', 'medium'].includes(raw)) return 'normal';
  if (['4', '5', 'large', 'x-large'].includes(raw)) return 'large';
  if (['6', '7', 'xx-large', 'xxx-large'].includes(raw)) return 'huge';
  const px = /^(\d+(?:\.\d+)?)px$/.exec(raw);
  if (px) {
    const n = Number(px[1]);
    return n <= 13 ? 'small' : n <= 16 ? 'normal' : n <= 21 ? 'large' : 'huge';
  }
  return undefined;
}

function marksOf(node: DomLike, base: Marks): Marks {
  const marks: Marks = { ...base };
  const tag = node.nodeName.toUpperCase();
  if (tag === 'B' || tag === 'STRONG') marks.b = true;
  if (tag === 'I' || tag === 'EM') marks.i = true;
  if (tag === 'U' || tag === 'INS') marks.u = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') marks.s = true;
  if (tag === 'A') {
    const href = safeHref(node.getAttribute?.('href') ?? '');
    if (href) marks.href = href;
  }
  if (tag === 'FONT') {
    const color = paletteKey<EmailColor>(EMAIL_COLORS, node.getAttribute?.('color') ?? null);
    if (color) marks.color = color;
    const size = sizeOf(node.getAttribute?.('size'));
    if (size) marks.size = size;
  }
  const style = node.style;
  if (style) {
    const weight = style.fontWeight ?? '';
    if (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) marks.b = true;
    if (style.fontStyle === 'italic') marks.i = true;
    const decoration = `${style.textDecorationLine ?? ''} ${style.textDecoration ?? ''}`;
    if (decoration.includes('underline')) marks.u = true;
    if (decoration.includes('line-through')) marks.s = true;
    const color = paletteKey<EmailColor>(EMAIL_COLORS, style.color ?? null);
    if (color) marks.color = color;
    const bg = paletteKey<EmailHighlight>(EMAIL_HIGHLIGHTS, style.backgroundColor ?? null);
    if (bg) marks.bg = bg;
    const size = sizeOf(style.fontSize);
    if (size) marks.size = size;
  }
  // Normal size and black are the defaults: not written as formats.
  if (marks.size === 'normal') delete marks.size;
  if (marks.color === 'black') delete marks.color;
  return marks;
}

const BLOCKS = new Set([
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'UL',
  'OL',
  'LI',
  'HR',
  'PRE',
  'TABLE',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
]);
const SKIPPED = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'HEAD', 'TITLE', 'META', 'IMG', 'IFRAME']);

const isBlock = (node: DomLike) => node.nodeType === ELEMENT && BLOCKS.has(node.nodeName);
const clean = (text: string) => text.replace(/[​‌‍﻿]/g, '').replace(/ /g, ' ');

const sameMarks = (a: Marks, b: Marks) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Marks>;
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
};

/** Text with its formats, line breaks as "\n"; nested blocks become line breaks too. */
function inlines(nodes: ArrayLike<DomLike>, base: Marks = {}): EmailInline[] {
  const out: EmailInline[] = [];
  const push = (text: string, marks: Marks) => {
    if (!text) return;
    const last = out.at(-1);
    if (last && sameMarks(marksOnly(last), marks)) last.text += text;
    else out.push({ text, ...marks });
  };
  const walk = (node: DomLike, marks: Marks) => {
    if (node.nodeType === TEXT) return push(clean(node.data ?? ''), marks);
    if (node.nodeType !== ELEMENT || SKIPPED.has(node.nodeName)) return;
    if (node.nodeName === 'BR') return push('\n', {});
    const inner = marksOf(node, marks);
    const block = isBlock(node);
    if (block && out.length > 0 && !out.at(-1)!.text.endsWith('\n')) push('\n', {});
    for (const child of Array.from(node.childNodes)) walk(child, inner);
  };
  for (const node of Array.from(nodes)) walk(node, base);
  // A trailing line break is how browsers keep an empty line open; it is not part of the text.
  const last = out.at(-1);
  if (last) {
    last.text = last.text.replace(/\n+$/, '');
    if (!last.text) out.pop();
  }
  return out;
}

function marksOnly(inline: EmailInline): Marks {
  const marks: Marks & { text?: string } = { ...inline };
  delete marks.text;
  return marks;
}

function alignOf(node: DomLike): 'center' | 'right' | undefined {
  const value = (node.style?.textAlign || node.getAttribute?.('align') || '').toLowerCase();
  return value === 'center' ? 'center' : value === 'right' ? 'right' : undefined;
}

function listItems(node: DomLike): EmailInline[][] {
  const items: EmailInline[][] = [];
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType !== ELEMENT) continue;
    if (child.nodeName === 'LI') {
      // A list inside an item is flattened into the same list: the editor makes one level.
      const own = Array.from(child.childNodes).filter(
        (part) =>
          !(part.nodeType === ELEMENT && (part.nodeName === 'UL' || part.nodeName === 'OL')),
      );
      items.push(inlines(own));
      for (const part of Array.from(child.childNodes)) {
        if (part.nodeType === ELEMENT && (part.nodeName === 'UL' || part.nodeName === 'OL')) {
          items.push(...listItems(part));
        }
      }
    } else if (child.nodeName === 'UL' || child.nodeName === 'OL') {
      items.push(...listItems(child));
    }
  }
  return items.length > 0 ? items : [[]];
}

/** The editable area's children → the document's blocks. */
export function domToEmailDoc(root: DomLike): EmailDoc {
  const doc: EmailBlock[] = [];
  let loose: DomLike[] = [];
  const flush = () => {
    if (loose.length === 0) return;
    const content = inlines(loose);
    loose = [];
    if (content.length > 0) doc.push({ type: 'paragraph', content });
  };
  for (const node of Array.from(root.childNodes)) {
    if (!isBlock(node)) {
      if (node.nodeType === ELEMENT && node.nodeName === 'BR' && loose.length === 0) {
        doc.push({ type: 'paragraph', content: [] });
      } else loose.push(node);
      continue;
    }
    flush();
    const name = node.nodeName;
    const align = alignOf(node);
    if (name === 'HR') doc.push({ type: 'rule' });
    else if (name === 'UL' || name === 'OL') {
      doc.push({ type: 'list', ordered: name === 'OL', items: listItems(node) });
    } else if (name === 'BLOCKQUOTE') {
      doc.push({ type: 'quote', content: inlines(node.childNodes) });
    } else if (name === 'H1' || name === 'H2' || name === 'H3') {
      doc.push({
        type: 'heading',
        level: Number(name[1]) as 1 | 2 | 3,
        ...(align ? { align } : {}),
        content: inlines(node.childNodes),
      });
    } else {
      // A paragraph, or a block the editor does not make (pasted), kept as its text.
      const content = inlines(node.childNodes);
      doc.push({ type: 'paragraph', ...(align ? { align } : {}), content });
    }
  }
  flush();
  // Empty lines at the start and end are not part of the email.
  const empty = (block: EmailBlock) =>
    block.type === 'paragraph' && block.content.every((item) => !item.text.trim());
  while (doc.length > 0 && empty(doc[0]!)) doc.shift();
  while (doc.length > 0 && empty(doc.at(-1)!)) doc.pop();
  return doc;
}
