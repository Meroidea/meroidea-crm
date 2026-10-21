import { describe, expect, it } from 'vitest';

import { renderEmail } from '@/server/email-template';

const base = {
  preheader: 'Choose your password with this one-time link.',
  heading: 'You have been added to Harbour Cafe',
  reason: 'You received this because an admin added you.',
};

describe('email template', () => {
  it('escapes everything a caller passes, in every block', () => {
    const { html } = renderEmail({
      ...base,
      sender: { kind: 'business', name: 'Harbour <Cafe>' },
      heading: 'Hi <b>there</b>',
      blocks: [
        { type: 'paragraph', text: 'Fish & <chips>' },
        { type: 'list', items: ['<script>x</script>'] },
        { type: 'details', rows: [{ label: 'A"b', value: "it's" }] },
        { type: 'message', text: '<img src=x onerror=alert(1)>' },
        { type: 'button', label: 'Go', url: 'https://example.com/?a="1"&b=<2>' },
      ],
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>there</b>');
    expect(html).toContain('Harbour &lt;Cafe&gt;');
    expect(html).toContain('Fish &amp; &lt;chips&gt;');
    expect(html).toContain('href="https://example.com/?a=&quot;1&quot;&amp;b=&lt;2&gt;"');
  });

  it('says the same in the text part, with every link spelled out', () => {
    const { text } = renderEmail({
      ...base,
      sender: { kind: 'platform' },
      blocks: [
        { type: 'paragraph', text: 'Welcome aboard.' },
        { type: 'list', items: ['One', 'Two'] },
        { type: 'button', label: 'Choose your password', url: 'https://crm.example.com/x' },
      ],
    });
    expect(text).toContain('You have been added to Harbour Cafe');
    expect(text).toContain('Welcome aboard.');
    expect(text).toContain('- One\n- Two');
    expect(text).toContain('Choose your password: https://crm.example.com/x');
    expect(text).toContain('The Meroidea team');
    expect(text).toContain(base.reason);
    expect(text).not.toContain('<');
  });

  it('uses a business colour only when it is a plain hex value', () => {
    const colour = (color: string) =>
      renderEmail({
        ...base,
        sender: { kind: 'business', name: 'Cafe', color },
        blocks: [{ type: 'button', label: 'Open', url: 'https://example.com' }],
      }).html;
    expect(colour('#0f766e')).toContain('background:#0f766e');
    const injected = colour('red;background:url(https://evil.example/x)');
    expect(injected).not.toContain('evil.example');
    expect(injected).toContain('background:#4b49ac');
  });

  it('keeps a personal email plain and leaves the signature to the writer', () => {
    const { html, text } = renderEmail({
      ...base,
      heading: undefined,
      sender: { kind: 'personal', name: 'Sam Lee', business: 'Harbour Cafe' },
      blocks: [
        { type: 'paragraph', text: 'Hi Jo,\nThanks for today.' },
        { type: 'paragraph', text: 'Sam' },
      ],
      signature: [],
    });
    expect(html).not.toContain('<h1');
    expect(html).toContain('Sent by Harbour Cafe with Meroidea');
    expect(text.startsWith('Hi Jo,\nThanks for today.')).toBe(true);
    expect(text).not.toContain('Sam Lee');
  });

  it('can keep an order’s prices out of the text part', () => {
    const { html, text } = renderEmail({
      ...base,
      sender: { kind: 'business', name: 'Cafe' },
      blocks: [
        {
          type: 'table',
          columns: ['Qty', 'Item'],
          rows: [['2', 'Flour']],
          textRows: ['2 x Flour'],
          totals: [{ label: 'Estimated total', value: '$40.00' }],
          totalsInText: false,
        },
      ],
    });
    expect(text).toContain('2 x Flour');
    expect(text).not.toContain('$40.00');
    expect(html).toContain('$40.00');
  });
});
