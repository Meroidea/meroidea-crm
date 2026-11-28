import { describe, expect, it } from 'vitest';

import {
  htmlToText,
  isAutomated,
  messageIds,
  newReplyToken,
  parseAddress,
  replyAddress,
  replySubject,
  replyTokenIn,
  reservedLocalPart,
  stripQuotedReply,
} from '@/modules/social/email-parse';
import { emailHtml } from '@/modules/social/email-service';
import { verifyResendSignature } from '@/modules/social/providers/resend';
import { composeEmailSchema } from '@/modules/social/schemas';

describe('Resend webhook signatures (Svix scheme)', () => {
  // Svix's own published example (docs.svix.com, manual verification).
  const secret = 'whsec_plJ3nmyCDGBKInavdOK15jsl';
  const body = new TextEncoder().encode('{"event_type":"ping","data":{"success":true}}');
  const headers = {
    id: 'msg_loFOjxBNrRLzqYUf',
    timestamp: '1731705121',
    signature: 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=',
  };
  const then = 1731705121 * 1000;

  it('accepts the documented example at its own time', () => {
    expect(verifyResendSignature(body, headers, secret, then)).toBe(true);
  });

  it('accepts any one valid signature in the list', () => {
    const list = { ...headers, signature: `v1,bm9wZQ== ${headers.signature} v2,c29tZQ==` };
    expect(verifyResendSignature(body, list, secret, then)).toBe(true);
  });

  it('refuses a changed body, another secret, a missing header, or an old delivery', () => {
    const changed = new TextEncoder().encode('{"event_type":"ping","data":{"success":false}}');
    expect(verifyResendSignature(changed, headers, secret, then)).toBe(false);
    expect(verifyResendSignature(body, headers, 'whsec_c29tZXRoaW5nIGVsc2U=', then)).toBe(false);
    expect(verifyResendSignature(body, { ...headers, id: null }, secret, then)).toBe(false);
    expect(verifyResendSignature(body, headers, secret, then + 6 * 60_000)).toBe(false);
    expect(verifyResendSignature(body, headers, 'plJ3nmyCDGBKInavdOK15jsl', then)).toBe(false);
  });
});

describe('reading addresses', () => {
  it('splits a display name from the address and lower-cases it', () => {
    expect(parseAddress('Sam Lee <Sam.Lee@Example.COM>')).toEqual({
      name: 'Sam Lee',
      email: 'sam.lee@example.com',
    });
    expect(parseAddress('"Lee, Sam" <sam@example.com>').name).toBe('Lee, Sam');
    expect(parseAddress('sam@example.com')).toEqual({ name: null, email: 'sam@example.com' });
    expect(parseAddress('not an address').email).toBeNull();
  });
});

describe('the words of an email', () => {
  it('turns HTML into plain text without scripts, styles or tags', () => {
    expect(
      htmlToText(
        '<style>p{color:red}</style><p>Hi &amp; welcome</p><script>alert(1)</script><p>Line&nbsp;two<br>three &#8212; done</p>',
      ),
    ).toBe('Hi & welcome\nLine two\nthree — done');
  });

  it('keeps a reply’s own words and drops the quoted history', () => {
    expect(
      stripQuotedReply(
        'Yes, Tuesday works.\n\nOn Mon, 23 Nov 2026 at 10:00, Harbour Cafe <hello@example.com> wrote:\n> Does Tuesday suit?',
      ),
    ).toBe('Yes, Tuesday works.');
    expect(stripQuotedReply('Thanks!\n\n-----Original Message-----\nFrom: x')).toBe('Thanks!');
    expect(stripQuotedReply('Sounds good\n> earlier line\n> another')).toBe('Sounds good');
  });

  it('keeps everything when nothing would be left', () => {
    expect(stripQuotedReply('> only a quote')).toBe('> only a quote');
  });

  it('escapes what is sent as HTML', () => {
    expect(emailHtml('<b>hi</b>\nthere')).toContain('&lt;b&gt;hi&lt;/b&gt;<br>there');
  });
});

describe('threading', () => {
  it('prefixes one Re:, whatever chain was there', () => {
    expect(replySubject('Order 1042')).toBe('Re: Order 1042');
    expect(replySubject('RE: Fwd: re: Order 1042')).toBe('Re: Order 1042');
    expect(replySubject(null)).toBe('Re: your message');
  });

  it('finds the thread token only in a reply address at the inbox domain', () => {
    const token = 'abcdefghijklmnopqrstuvwx';
    const domain = 'inbox.example.com';
    expect(replyAddress(token, domain)).toBe(`r-${token}@${domain}`);
    expect(
      replyTokenIn(
        ['Cafe <hello@inbox.example.com>', `R-${token.toUpperCase()}@Inbox.Example.com`],
        domain,
      ),
    ).toBe(token);
    expect(replyTokenIn([`r-${token}@elsewhere.example.com`], domain)).toBeNull();
    expect(replyTokenIn([`r-short@${domain}`], domain)).toBeNull();
  });

  it('makes reply tokens of 24 lower-case letters and digits, each one new', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newReplyToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[a-z0-9]{24}$/);
    // Every character can turn up: a broken alphabet or index would leave some out.
    expect(new Set([...tokens].join('')).size).toBe(36);
  });

  it('reads Message-IDs from In-Reply-To and References', () => {
    expect(messageIds('<a@x.com> <b@y.com>\n <a@x.com>')).toEqual(['<a@x.com>', '<b@y.com>']);
    expect(messageIds(undefined)).toEqual([]);
  });
});

describe('machine-sent mail', () => {
  it('is recognised by its headers or sender', () => {
    expect(isAutomated({ 'auto-submitted': 'auto-replied' }, 'sam@example.com')).toBe(true);
    expect(isAutomated({ 'auto-submitted': 'no' }, 'sam@example.com')).toBe(false);
    expect(isAutomated({ precedence: 'bulk' }, 'sam@example.com')).toBe(true);
    expect(isAutomated({}, 'mailer-daemon@example.com')).toBe(true);
    expect(isAutomated({}, 'no-reply@example.com')).toBe(true);
    expect(isAutomated({}, 'sam@example.com')).toBe(false);
  });
});

describe('inbox addresses', () => {
  it('keeps the platform’s own and reply addresses out of reach', () => {
    expect(reservedLocalPart('postmaster')).toBe(true);
    expect(reservedLocalPart('r-abc')).toBe(true);
    expect(reservedLocalPart('harbour..cafe')).toBe(true);
    expect(reservedLocalPart('harbour-cafe')).toBe(false);
  });
});

describe('a composed email (ADR-089, ADR-090)', () => {
  const doc = [{ type: 'paragraph', content: [{ text: 'Hello' }] }];
  const valid = {
    accountId: '00000000-0000-4000-8000-000000000000',
    to: ['  Kim@Example.COM '],
    cc: ['lee@example.com'],
    subject: ' Your quote ',
    doc,
  };

  it('keeps addresses in lower case, trims what was typed, and defaults Bcc and files', () => {
    expect(composeEmailSchema.parse(valid)).toEqual({
      accountId: valid.accountId,
      to: ['kim@example.com'],
      cc: ['lee@example.com'],
      bcc: [],
      subject: 'Your quote',
      doc,
      attachments: [],
    });
  });

  it('needs a real address to send to, a subject and some words', () => {
    expect(composeEmailSchema.safeParse({ ...valid, to: [] }).success).toBe(false);
    expect(composeEmailSchema.safeParse({ ...valid, to: ['not an address'] }).success).toBe(false);
    expect(composeEmailSchema.safeParse({ ...valid, bcc: ['kim@'] }).success).toBe(false);
    expect(composeEmailSchema.safeParse({ ...valid, subject: '  ' }).success).toBe(false);
    expect(
      composeEmailSchema.safeParse({
        ...valid,
        doc: [{ type: 'paragraph', content: [{ text: ' ' }] }],
      }).success,
    ).toBe(false);
  });

  it('goes to at most 50 people, and carries at most 10 files', () => {
    const many = Array.from({ length: 30 }, (_, index) => `p${index}@example.com`);
    expect(composeEmailSchema.safeParse({ ...valid, to: many, cc: many }).success).toBe(true);
    const more = Array.from({ length: 21 }, (_, index) => `q${index}@example.com`);
    expect(composeEmailSchema.safeParse({ ...valid, to: many, cc: more }).success).toBe(false);
    const file = { path: 'x', fileName: 'a.pdf', mimeType: 'application/pdf' };
    expect(
      composeEmailSchema.safeParse({ ...valid, attachments: Array(11).fill(file) }).success,
    ).toBe(false);
  });
});
