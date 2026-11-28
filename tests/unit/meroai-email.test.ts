import { describe, expect, it } from 'vitest';

import { splitAtSignature } from '@/modules/ai/email-signature';
import type { EmailDoc } from '@/modules/social/email-doc';

// MeroAI writes above the signature and keeps it, and anything after it, as it was (ADR-092).

const p = (text: string): EmailDoc[number] => ({
  type: 'paragraph',
  content: text ? [{ text }] : [],
});
const signature: EmailDoc = [p('Sam Example'), p('Harbour Cafe')];

describe('splitting an email at the signature', () => {
  it('finds the signature below the words, with blank lines between', () => {
    const doc = [p('Hi Kim'), p(''), p(''), ...signature];
    expect(splitAtSignature(doc, signature)).toEqual({
      body: [p('Hi Kim')],
      rest: signature,
      signed: true,
    });
  });

  it('keeps a forwarded email after the signature with it', () => {
    const forwarded = [p('---------- Forwarded message ----------'), p('Original words')];
    const doc = [p(''), ...signature, ...forwarded];
    const split = splitAtSignature(doc, signature);
    expect(split.body).toEqual([]);
    expect(split.rest).toEqual([...signature, ...forwarded]);
  });

  it('is unsigned when the signature was deleted or there is none', () => {
    expect(splitAtSignature([p('Hi'), p('Sam Example')], signature)).toMatchObject({
      signed: false,
      body: [p('Hi'), p('Sam Example')],
    });
    expect(splitAtSignature([p('Hi'), p('')], null)).toEqual({
      body: [p('Hi')],
      rest: [],
      signed: false,
    });
  });
});
