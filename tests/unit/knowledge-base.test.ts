import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Markdown } from '@/modules/kb/components/markdown';
import { articleSchema, articleSlug } from '@/modules/kb/schemas';

const render = (markdown: string) => renderToStaticMarkup(createElement(Markdown, null, markdown));

describe('article Markdown on the portal', () => {
  it('renders ordinary Markdown', () => {
    const html = render('# Opening hours\n\nWe open at **8**.\n\n- Mon\n- Tue');
    expect(html).toContain('<h1>Opening hours</h1>');
    expect(html).toContain('<strong>8</strong>');
    expect(html).toContain('<li>Mon</li>');
  });

  it('never renders raw HTML from the article', () => {
    const html = render('Hi <script>alert(1)</script> <img src=x onerror="alert(1)"> <b>bold</b>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<b>');
  });

  it('drops dangerous link addresses and opens others safely', () => {
    const html = render('[click](javascript:alert(1)) and [site](https://example.com)');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer nofollow ugc"');
  });

  it('shows pictures over https only, without a referrer', () => {
    const html = render('![a](http://example.com/a.png) ![b](https://example.com/b.png)');
    expect(html).not.toContain('http://example.com/a.png');
    expect(html).toContain('src="https://example.com/b.png"');
    expect(html).toContain('referrerPolicy="no-referrer"');
  });
});

describe('article addresses', () => {
  it('are made from the title', () => {
    expect(articleSlug('How do I change my booking?')).toBe('how-do-i-change-my-booking');
    expect(articleSlug('Café opening — hours')).toBe('cafe-opening-hours');
  });

  it('accept only lower-case letters, numbers and dashes', () => {
    const base = { title: 'T', bodyMarkdown: '', status: 'draft' as const };
    expect(articleSchema.safeParse({ ...base, slug: 'ok-slug-1' }).success).toBe(true);
    expect(articleSchema.safeParse({ ...base, slug: '../etc' }).success).toBe(false);
    expect(articleSchema.safeParse({ ...base, slug: '' }).data?.slug).toBeUndefined();
  });
});
