import { describe, expect, it } from 'vitest';

import { emailDocSchema } from '@/modules/social/email-doc';
import { domToEmailDoc, type DomLike } from '@/modules/social/email-editor-dom';

// The editor's contents → an email document (ADR-090), on hand-built nodes shaped like the ones
// browsers make for the toolbar's formats.

const text = (data: string): DomLike => ({ nodeType: 3, nodeName: '#text', childNodes: [], data });
const el = (
  nodeName: string,
  children: DomLike[] = [],
  options: { attrs?: Record<string, string>; style?: DomLike['style'] } = {},
): DomLike => ({
  nodeType: 1,
  nodeName,
  childNodes: children,
  getAttribute: (name) => options.attrs?.[name] ?? null,
  style: options.style ?? {},
});
const root = (...children: DomLike[]) => el('DIV', children);

describe('reading the editor', () => {
  it('keeps paragraphs and each format the toolbar makes', () => {
    const doc = domToEmailDoc(
      root(
        el('P', [
          text('Hi '),
          el('B', [text('Kim')]),
          text(', '),
          el('I', [el('U', [text('see')])]),
          text(' '),
          el('A', [text('menu')], { attrs: { href: 'https://example.com/menu' } }),
          el('FONT', [text(' red')], { attrs: { color: '#cf222e', size: '6' } }),
          el('SPAN', [text(' lit')], { style: { backgroundColor: 'rgb(255, 243, 163)' } }),
          el('STRIKE', [text(' old')]),
        ]),
        el('P', [text('Second')], { style: { textAlign: 'center' } }),
      ),
    );
    expect(doc).toEqual([
      {
        type: 'paragraph',
        content: [
          { text: 'Hi ' },
          { text: 'Kim', b: true },
          { text: ', ' },
          { text: 'see', i: true, u: true },
          { text: ' ' },
          { text: 'menu', href: 'https://example.com/menu' },
          { text: ' red', color: 'red', size: 'huge' },
          { text: ' lit', bg: 'yellow' },
          { text: ' old', s: true },
        ],
      },
      { type: 'paragraph', align: 'center', content: [{ text: 'Second' }] },
    ]);
    expect(emailDocSchema.safeParse(doc).success).toBe(true);
  });

  it('reads lists, quotes, headings, rules and line breaks', () => {
    const doc = domToEmailDoc(
      root(
        el('H2', [text('Menu')]),
        el('UL', [el('LI', [text('Soup')]), el('LI', [text('Bread')])]),
        el('OL', [el('LI', [text('First')])]),
        el('BLOCKQUOTE', [text('one'), el('BR'), text('two')]),
        el('HR'),
        el('DIV', [text('line'), el('BR'), text('break')]),
      ),
    );
    expect(doc).toEqual([
      { type: 'heading', level: 2, content: [{ text: 'Menu' }] },
      { type: 'list', ordered: false, items: [[{ text: 'Soup' }], [{ text: 'Bread' }]] },
      { type: 'list', ordered: true, items: [[{ text: 'First' }]] },
      { type: 'quote', content: [{ text: 'one\ntwo' }] },
      { type: 'rule' },
      { type: 'paragraph', content: [{ text: 'line\nbreak' }] },
    ]);
  });

  it('drops scripts, pictures, unsafe links and colours it does not offer', () => {
    const doc = domToEmailDoc(
      root(
        el('P', [
          el('SCRIPT', [text('alert(1)')]),
          el('IMG', [], { attrs: { src: 'https://tracker.example/pixel' } }),
          el('A', [text('click')], { attrs: { href: 'javascript:alert(1)' } }),
          el('SPAN', [text(' odd')], { style: { color: 'rgb(1, 2, 3)' } }),
        ]),
      ),
    );
    expect(doc).toEqual([{ type: 'paragraph', content: [{ text: 'click odd' }] }]);
  });

  it('leaves out empty lines at the start and end, and non-breaking spaces', () => {
    const doc = domToEmailDoc(
      root(el('P', [el('BR')]), el('P', [text('a b​')]), el('P', [el('BR')])),
    );
    expect(doc).toEqual([{ type: 'paragraph', content: [{ text: 'a b' }] }]);
  });

  it('keeps text typed straight into the editor as a paragraph', () => {
    expect(domToEmailDoc(root(text('Hello '), el('B', [text('there')])))).toEqual([
      { type: 'paragraph', content: [{ text: 'Hello ' }, { text: 'there', b: true }] },
    ]);
  });
});

describe('reading fonts, tables and pictures (ADR-091)', () => {
  const path =
    '11111111-1111-4111-8111-111111111111/social/compose/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.png';

  it('reads a font, a table and a picture the editor put in', () => {
    const doc = domToEmailDoc(
      root(
        el('P', [el('FONT', [text('Georgia text')], { attrs: { face: 'Georgia' } })]),
        el('TABLE', [
          el('TBODY', [
            el('TR', [el('TH', [text('Dish')]), el('TH', [text('Price')])]),
            el('TR', [el('TD', [text('Soup')]), el('TD', [text('$9')])]),
          ]),
        ]),
        el('P', [el('IMG', [], { attrs: { 'data-path': path, alt: 'logo', width: '200' } })]),
      ),
    );
    expect(doc).toEqual([
      { type: 'paragraph', content: [{ text: 'Georgia text', font: 'georgia' }] },
      {
        type: 'table',
        header: true,
        rows: [
          [[{ text: 'Dish' }], [{ text: 'Price' }]],
          [[{ text: 'Soup' }], [{ text: '$9' }]],
        ],
      },
      { type: 'image', path, alt: 'logo', width: 200 },
    ]);
  });

  it('drops pictures that did not come from a Compose upload', () => {
    const doc = domToEmailDoc(
      root(
        el('P', [text('Hi'), el('IMG', [], { attrs: { src: 'https://tracker.example/p.gif' } })]),
        el('IMG', [], { attrs: { 'data-path': 'https://tracker.example/p.gif' } }),
      ),
    );
    expect(doc).toEqual([{ type: 'paragraph', content: [{ text: 'Hi' }] }]);
  });
});
