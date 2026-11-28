import { emailDocText, type EmailDoc } from '@/modules/social/email-doc';

const blockKey = (block: EmailDoc[number]) => `${block.type}:${emailDocText([block]).trim()}`;
const isBlank = (block: EmailDoc[number] | undefined) =>
  Boolean(block) && block!.type === 'paragraph' && !emailDocText([block!]).trim();

/**
 * Splits what is in the editor into the person's own words and what follows them: their
 * signature, and anything after it (a forwarded email). MeroAI writes and rewrites the words
 * only; the rest is kept exactly as it was.
 */
export function splitAtSignature(
  doc: EmailDoc,
  signature: EmailDoc | null,
): { body: EmailDoc; rest: EmailDoc; signed: boolean } {
  const keys = (signature ?? []).filter((block) => !isBlank(block)).map(blockKey);
  if (keys.length > 0) {
    const docKeys = doc.map(blockKey);
    for (let start = docKeys.length - 1; start >= 0; start -= 1) {
      let at = start;
      let matched = 0;
      while (at < docKeys.length && matched < keys.length) {
        if (isBlank(doc[at])) at += 1;
        else if (docKeys[at] === keys[matched]) {
          at += 1;
          matched += 1;
        } else break;
      }
      if (matched === keys.length) {
        const body = doc.slice(0, start);
        while (isBlank(body[body.length - 1])) body.pop();
        return { body, rest: doc.slice(start), signed: true };
      }
    }
  }
  const body = [...doc];
  while (isBlank(body[body.length - 1])) body.pop();
  return { body, rest: [], signed: false };
}
