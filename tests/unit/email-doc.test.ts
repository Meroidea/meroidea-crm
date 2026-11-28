import { describe, expect, it } from 'vitest';

import {
  emailDocEditorHtml,
  emailDocHtml,
  emailDocSchema,
  emailDocText,
  safeHref,
  textToEmailDoc,
  type EmailDoc,
} from '@/modules/social/email-doc';

// Formatted email (ADR-090): the server builds the HTML from a checked document, so nothing
// typed or pasted can become markup.

const doc: EmailDoc = [
  { type: 'heading', level: 2, content: [{ text: 'Your quote' }] },
  {
    type: 'paragraph',
    align: 'center',
    content: [
      { text: 'Hi ' },
      { text: 'Kim', b: true },
      { text: ', see ', i: true },
      { text: 'our menu', href: 'https://example.com/menu', u: true },
      { text: ' in red', color: 'red', bg: 'yellow', size: 'large' },
    ],
  },
  { type: 'list', ordered: true, items: [[{ text: 'One' }], [{ text: 'Two', s: true }]] },
  { type: 'quote', content: [{ text: 'line one\nline two' }] },
  { type: 'rule' },
];

describe('formatted email documents', () => {
  it('accepts the formats the editor offers', () => {
    expect(emailDocSchema.safeParse(doc).success).toBe(true);
  });

  it('writes HTML with each format, escaped, and nothing else', () => {
    const html = emailDocHtml(doc);
    expect(html).toContain('<strong>Kim</strong>');
    expect(html).toContain('<em>, see </em>');
    expect(html).toContain('href="https://example.com/menu"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('color:#cf222e');
    expect(html).toContain('text-align:center');
    expect(html).toContain('<ol');
    expect(html).toContain('<s>Two</s>');
    expect(html).toContain('line one<br>line two');
    expect(html).toContain('<hr');
  });

  it('turns typed markup into text, never into tags', () => {
    const html = emailDocHtml([
      {
        type: 'paragraph',
        content: [{ text: '<script>alert(1)</script><img src=x onerror=alert(1)> "quoted"' }],
      },
    ]);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;quoted&quot;');
  });

  it('refuses links that could run code, and any format it does not know', () => {
    for (const href of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:x',
      'file:///etc/passwd',
      '/relative',
    ]) {
      expect(safeHref(href)).toBeNull();
      expect(
        emailDocSchema.safeParse([{ type: 'paragraph', content: [{ text: 'x', href }] }]).success,
      ).toBe(false);
    }
    expect(safeHref('mailto:kim@example.com')).toBe('mailto:kim@example.com');
    const unknown = [
      { type: 'paragraph', content: [{ text: 'x', style: 'position:fixed' }] },
      { type: 'paragraph', content: [{ text: 'x', color: '#ff0000' }] },
      { type: 'html', content: '<b>x</b>' },
    ];
    for (const block of unknown) expect(emailDocSchema.safeParse([block]).success).toBe(false);
  });

  it('a link’s address cannot break out of its attribute', () => {
    const html = emailDocHtml([
      {
        type: 'paragraph',
        content: [{ text: 'x', href: 'https://example.com/?q="><script>alert(1)</script>' }],
      },
    ]);
    expect(html).not.toContain('"><script');
  });

  it('needs some words, and no more than the limit', () => {
    expect(emailDocSchema.safeParse([]).success).toBe(false);
    expect(
      emailDocSchema.safeParse([{ type: 'paragraph', content: [{ text: '   ' }] }]).success,
    ).toBe(false);
    expect(
      emailDocSchema.safeParse([
        { type: 'paragraph', content: [{ text: 'x'.repeat(15_000) }] },
        { type: 'paragraph', content: [{ text: 'y'.repeat(6_000) }] },
      ]).success,
    ).toBe(false);
  });

  it('gives the same email as plain text, links written out', () => {
    expect(emailDocText(doc)).toBe(
      [
        'Your quote',
        'Hi Kim, see our menu (https://example.com/menu) in red',
        '1. One\n2. Two',
        '> line one\n> line two',
        '---',
      ].join('\n\n'),
    );
    expect(emailDocText(textToEmailDoc('First\n\nSecond'))).toBe('First\n\nSecond');
  });
});

describe('fonts, tables and pictures (ADR-091)', () => {
  const tenant = '11111111-1111-4111-8111-111111111111';
  const user = '22222222-2222-4222-8222-222222222222';
  const path = `${tenant}/social/compose/${user}/33333333-3333-4333-8333-333333333333.png`;

  it('writes a font, a table with a header row and an embedded picture', () => {
    const doc: EmailDoc = [
      { type: 'paragraph', content: [{ text: 'Menu', font: 'georgia' }] },
      {
        type: 'table',
        header: true,
        rows: [
          [[{ text: 'Dish' }], [{ text: 'Price' }]],
          [[{ text: 'Soup <hot>' }], [{ text: '$9' }]],
        ],
      },
      { type: 'image', path, alt: 'Our "logo"', width: 200 },
    ];
    expect(emailDocSchema.safeParse(doc).success).toBe(true);
    const html = emailDocHtml(doc, { imageSrc: (p) => (p === path ? 'cid:logo@meroidea' : null) });
    expect(html).toContain('font-family:Georgia,serif');
    expect(html).toContain('<th style=');
    expect(html).toContain('Soup &lt;hot&gt;');
    expect(html).toContain('src="cid:logo@meroidea"');
    expect(html).toContain('alt="Our &quot;logo&quot;"');
    expect(html).toContain('width="200"');
    expect(emailDocText(doc)).toBe(
      'Menu\n\nDish | Price\nSoup <hot> | $9\n\n[Picture: Our "logo"]',
    );
  });

  it('leaves out a picture it has no source for', () => {
    expect(emailDocHtml([{ type: 'image', path, alt: '' }])).not.toContain('<img');
  });

  it('takes pictures only from a Compose folder, never an address', () => {
    for (const bad of [
      'https://tracker.example/pixel.png',
      'javascript:alert(1)',
      `${tenant}/documents/${user}/x.png`,
      `${tenant}/social/compose/${user}/../../secret.png`,
    ]) {
      expect(emailDocSchema.safeParse([{ type: 'image', path: bad, alt: '' }]).success).toBe(false);
    }
  });

  it('accepts an email that is only a picture, but not more than 20 pictures', () => {
    expect(emailDocSchema.safeParse([{ type: 'image', path, alt: '' }]).success).toBe(true);
    const many = Array.from({ length: 21 }, () => ({ type: 'image' as const, path, alt: '' }));
    expect(emailDocSchema.safeParse(many).success).toBe(false);
  });

  it('refuses a font it does not offer, and tables over 10 columns', () => {
    expect(
      emailDocSchema.safeParse([
        { type: 'paragraph', content: [{ text: 'x', font: 'Comic Sans; color:red' }] },
      ]).success,
    ).toBe(false);
    const wide = [Array.from({ length: 11 }, () => [{ text: 'x' }])];
    expect(emailDocSchema.safeParse([{ type: 'table', header: false, rows: wide }]).success).toBe(
      false,
    );
  });

  it('opens a document in the editor as the tags it reads back', () => {
    const html = emailDocEditorHtml(
      [
        { type: 'heading', level: 2, content: [{ text: 'Hi', b: true, font: 'courier' }] },
        { type: 'image', path, alt: 'x' },
      ],
      () => '/api/social/compose-file/x.png',
    );
    expect(html).toContain('<h2><font face="Courier New"><b>Hi</b></font></h2>');
    expect(html).toContain(`data-path="${path}"`);
  });
});
