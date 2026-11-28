import type { FieldKind } from './geometry';

/** Business rules for signing. Pure; used by the signer path, the staff path and tests. */

type SignerState = { id: string; position: number; status: string };

/**
 * In order, a signer's turn comes once everyone before them has signed. In parallel, everyone
 * still to sign may sign now.
 */
export function signersWhoseTurnItIs<T extends SignerState>(
  signers: T[],
  order: 'parallel' | 'sequential',
): T[] {
  const pending = signers.filter((signer) => signer.status === 'pending');
  if (order === 'parallel') return pending;
  const next = [...signers]
    .sort((a, b) => a.position - b.position)
    .find((s) => s.status !== 'signed');
  return next && next.status === 'pending' ? [next] : [];
}

/** The first signer still to sign before this one, in order; null when it is their turn. */
export function waitingOn<T extends SignerState>(
  signers: T[],
  signerId: string,
  order: 'parallel' | 'sequential',
): T | null {
  if (order === 'parallel') return null;
  const me = signers.find((signer) => signer.id === signerId);
  if (!me) return null;
  return (
    [...signers]
      .sort((a, b) => a.position - b.position)
      .find((signer) => signer.position < me.position && signer.status !== 'signed') ?? null
  );
}

export type DraftProblem = { message: string };

/** What must be true before a request goes out. */
export function sendProblems(input: {
  signers: { id: string; name: string }[];
  fields: { signerId: string; kind: FieldKind; page: number }[];
  pageCount: number;
}): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (input.signers.length === 0) problems.push({ message: 'Add at least one signer.' });
  for (const signer of input.signers) {
    const theirs = input.fields.filter((field) => field.signerId === signer.id);
    if (!theirs.some((field) => field.kind === 'signature')) {
      problems.push({ message: `Place a signature field for ${signer.name}.` });
    }
  }
  if (input.fields.some((field) => field.page > input.pageCount)) {
    problems.push({ message: 'A field is on a page the document does not have.' });
  }
  return problems;
}

export type FieldToFill = { id: string; kind: FieldKind; required: boolean };

/**
 * Checks what a signer typed against their own fields and returns the value to store for each.
 * Signature and initials come from the uploaded images and the date from the server's clock, so
 * a signer can neither skip nor backdate them.
 */
export function resolveFieldValues(
  fields: FieldToFill[],
  submitted: { fieldId: string; value: string }[],
  context: { signedOn: string; signaturePath: string; initialsPath: string | null },
): { values: Map<string, string | null> } | { error: string } {
  const byId = new Map(submitted.map((entry) => [entry.fieldId, entry.value]));
  const known = new Set(fields.map((field) => field.id));
  if (submitted.some((entry) => !known.has(entry.fieldId))) {
    return { error: 'That form no longer matches the document. Reload the page and try again.' };
  }
  if (byId.size !== submitted.length) {
    return { error: 'A field was sent twice. Reload the page and try again.' };
  }

  const values = new Map<string, string | null>();
  for (const field of fields) {
    const raw = (byId.get(field.id) ?? '').replace(/\s+/g, ' ').trim();
    switch (field.kind) {
      case 'signature':
        values.set(field.id, context.signaturePath);
        break;
      case 'initials':
        if (!context.initialsPath) return { error: 'Add your initials.' };
        values.set(field.id, context.initialsPath);
        break;
      case 'date':
        values.set(field.id, context.signedOn);
        break;
      case 'checkbox': {
        const ticked = raw === 'true';
        if (raw !== '' && raw !== 'true' && raw !== 'false') {
          return { error: 'A checkbox has an unexpected value.' };
        }
        if (field.required && !ticked) return { error: 'Tick every required checkbox.' };
        values.set(field.id, ticked ? 'true' : 'false');
        break;
      }
      case 'name':
      case 'text': {
        const limit = field.kind === 'name' ? 120 : 500;
        if (raw.length > limit) return { error: `A field is longer than ${limit} characters.` };
        if (field.required && !raw) return { error: 'Fill in every required field.' };
        values.set(field.id, raw || null);
        break;
      }
    }
  }
  return { values };
}

/** j•••@example.com — enough to know which inbox to check, not enough to harvest. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
}
