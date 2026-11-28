import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, asc, count, desc, eq, ilike, isNotNull, isNull, or } from 'drizzle-orm';

import {
  contacts,
  emailDrafts,
  emailSignatures,
  socialAccounts,
  socialConversations,
  socialMessages,
} from '@/db/schema';
import { AppError } from '@/lib/errors';
import { scopeFilter } from '@/lib/permissions/scope';
import { contactScope } from '@/modules/contacts/access';
import { audit } from '@/server/audit';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';
import { copySocialMedia, removeSocialMedia } from '@/server/storage';

import {
  emailDocDraftSchema,
  emailDocImagePaths,
  emailDocText,
  readStoredCompose,
  textToEmailDoc,
  withImagePaths,
  type EmailDoc,
} from './email-doc';
import type { StoredAttachment } from './media';
import {
  COMPOSE_FILE_TYPES,
  emailDraftSchema,
  MAX_COMPOSE_FILE_BYTES,
  MAX_COMPOSE_FILES,
  type EmailDraftInput,
  type EmailSignatureInput,
} from './schemas';

/*
 * Drafts and signatures (ADR-091). Both belong to one person: RLS (`email_drafts_own`,
 * `email_signatures_own`) lets only them read or write their own, and every query here also
 * filters on their own id. Files and pictures they name must be in their own Compose folder.
 */

/** Where one person's Compose files are kept (the same folder Compose uploads to). */
export const composeFolder = (ctx: TenantContext) =>
  `${ctx.tenantId}/social/compose/${ctx.userId}/`;

/** Every path a draft or signature names must be the person's own Compose file. */
function assertOwnFiles(ctx: TenantContext, paths: string[]) {
  const prefix = composeFolder(ctx);
  for (const path of paths) {
    if (!path.startsWith(prefix) || path.includes('..')) {
      throw new AppError('VALIDATION', 'A file in this email belongs to someone else.');
    }
  }
}

async function assertLiveInbox(tx: Tx, ctx: TenantContext, accountId: string) {
  const [inbox] = await tx
    .select({ id: socialAccounts.id })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.tenantId, ctx.tenantId),
        eq(socialAccounts.id, accountId),
        eq(socialAccounts.platform, 'email'),
        isNull(socialAccounts.disconnectedAt),
      ),
    )
    .limit(1);
  if (!inbox) throw new AppError('NOT_FOUND', 'That inbox was not found.');
}

/* --------------------------------------------------------------------------- drafts */

export type DraftContent = Omit<EmailDraftInput, 'id'>;

/** Saves the email being written: a new draft, or the same one again. */
export async function saveDraft(
  ctx: TenantContext,
  input: EmailDraftInput,
  now = new Date(),
): Promise<{ id: string; savedAt: string }> {
  requirePermission(ctx, 'social.reply');
  assertOwnFiles(ctx, [
    ...input.attachments.map((file) => file.path),
    ...emailDocImagePaths(input.doc),
  ]);
  const { id, ...content } = input;
  const subject = input.subject.trim().slice(0, 200);
  return withRls(ctx, async (tx) => {
    await assertLiveInbox(tx, ctx, input.accountId);
    if (id) {
      const [updated] = await tx
        .update(emailDrafts)
        .set({ accountId: input.accountId, subject, content, updatedAt: now })
        .where(
          and(
            eq(emailDrafts.tenantId, ctx.tenantId),
            eq(emailDrafts.userId, ctx.userId),
            eq(emailDrafts.id, id),
          ),
        )
        .returning({ id: emailDrafts.id });
      if (!updated) throw new AppError('NOT_FOUND', 'That draft was not found.');
      return { id: updated.id, savedAt: now.toISOString() };
    }
    const [created] = await tx
      .insert(emailDrafts)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        accountId: input.accountId,
        subject,
        content,
        updatedAt: now,
      })
      .returning({ id: emailDrafts.id });
    return { id: created!.id, savedAt: now.toISOString() };
  });
}

/** One of the person's own drafts, checked again as it is opened; null when not theirs. */
export async function getDraft(
  ctx: TenantContext,
  id: string,
): Promise<(DraftContent & { id: string }) | null> {
  requirePermission(ctx, 'social.reply');
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({
        id: emailDrafts.id,
        accountId: emailDrafts.accountId,
        content: emailDrafts.content,
      })
      .from(emailDrafts)
      .where(
        and(
          eq(emailDrafts.tenantId, ctx.tenantId),
          eq(emailDrafts.userId, ctx.userId),
          eq(emailDrafts.id, id),
        ),
      )
      .limit(1),
  );
  if (!row) return null;
  const parsed = emailDraftSchema.safeParse({
    ...(row.content as object),
    accountId: row.accountId,
  });
  if (!parsed.success) return null;
  const { accountId, to, cc, bcc, subject, doc, attachments } = parsed.data;
  return { id: row.id, accountId, to, cc, bcc, subject, doc, attachments };
}

export type DraftRow = {
  id: string;
  subject: string;
  to: string[];
  preview: string;
  updatedAt: Date;
};

/** The person's own drafts, latest first. */
export async function listDrafts(ctx: TenantContext): Promise<DraftRow[]> {
  requirePermission(ctx, 'social.reply');
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({
        id: emailDrafts.id,
        subject: emailDrafts.subject,
        content: emailDrafts.content,
        updatedAt: emailDrafts.updatedAt,
      })
      .from(emailDrafts)
      .where(and(eq(emailDrafts.tenantId, ctx.tenantId), eq(emailDrafts.userId, ctx.userId)))
      .orderBy(desc(emailDrafts.updatedAt))
      .limit(100),
  );
  return rows.map((row) => {
    const content = emailDraftSchema.partial().safeParse(row.content);
    const doc = content.success ? (content.data.doc ?? []) : [];
    return {
      id: row.id,
      subject: row.subject,
      to: content.success ? (content.data.to ?? []) : [],
      preview: emailDocText(doc).replace(/\s+/g, ' ').slice(0, 140),
      updatedAt: row.updatedAt,
    };
  });
}

/** How many drafts the person has, for the Drafts folder. */
export async function countDrafts(ctx: TenantContext): Promise<number> {
  requirePermission(ctx, 'social.reply');
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({ n: count() })
      .from(emailDrafts)
      .where(and(eq(emailDrafts.tenantId, ctx.tenantId), eq(emailDrafts.userId, ctx.userId))),
  );
  return row?.n ?? 0;
}

/**
 * Deletes one of the person's drafts. Discarding also removes its files and pictures from their
 * Compose folder; a sent draft keeps them, because the sent email uses them.
 */
export async function deleteDraft(
  ctx: TenantContext,
  id: string,
  options: { removeFiles: boolean },
): Promise<void> {
  requirePermission(ctx, 'social.reply');
  const draft = options.removeFiles ? await getDraft(ctx, id) : null;
  const [deleted] = await withRls(ctx, (tx) =>
    tx
      .delete(emailDrafts)
      .where(
        and(
          eq(emailDrafts.tenantId, ctx.tenantId),
          eq(emailDrafts.userId, ctx.userId),
          eq(emailDrafts.id, id),
        ),
      )
      .returning({ id: emailDrafts.id }),
  );
  if (!deleted) throw new AppError('NOT_FOUND', 'That draft was not found.');
  if (draft) {
    const paths = [...draft.attachments.map((file) => file.path), ...emailDocImagePaths(draft.doc)];
    // The signature may use a picture too: never remove a file it still shows.
    const signature = await getSignature(ctx);
    const keep = new Set(signature ? emailDocImagePaths(signature.doc) : []);
    const removable = paths.filter(
      (path) => path.startsWith(composeFolder(ctx)) && !keep.has(path),
    );
    if (removable.length > 0) await removeSocialMedia(removable);
  }
}

/** Deletes a draft inside a send's own transaction, once the email is stored (files kept). */
export async function deleteSentDraft(tx: Tx, ctx: TenantContext, id: string): Promise<void> {
  await tx
    .delete(emailDrafts)
    .where(
      and(
        eq(emailDrafts.tenantId, ctx.tenantId),
        eq(emailDrafts.userId, ctx.userId),
        eq(emailDrafts.id, id),
      ),
    );
}

/* ------------------------------------------------------------------------ signatures */

export type Signature = { doc: EmailDoc; useOnNew: boolean; useOnReplies: boolean };

/** The person's own signature in this business, or null. */
export async function getSignature(ctx: TenantContext): Promise<Signature | null> {
  requirePermission(ctx, 'social.reply');
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({
        doc: emailSignatures.doc,
        useOnNew: emailSignatures.useOnNew,
        useOnReplies: emailSignatures.useOnReplies,
      })
      .from(emailSignatures)
      .where(
        and(eq(emailSignatures.tenantId, ctx.tenantId), eq(emailSignatures.userId, ctx.userId)),
      )
      .limit(1),
  );
  if (!row) return null;
  const doc = emailDocDraftSchema.safeParse(row.doc);
  return doc.success
    ? { doc: doc.data, useOnNew: row.useOnNew, useOnReplies: row.useOnReplies }
    : null;
}

/** Saves the person's signature; an empty one is removed. */
export async function saveSignature(
  ctx: TenantContext,
  input: EmailSignatureInput,
  now = new Date(),
): Promise<void> {
  requirePermission(ctx, 'social.reply');
  assertOwnFiles(ctx, emailDocImagePaths(input.doc));
  const empty = !emailDocText(input.doc).trim() && emailDocImagePaths(input.doc).length === 0;
  await withRls(ctx, async (tx) => {
    if (empty) {
      await tx
        .delete(emailSignatures)
        .where(
          and(eq(emailSignatures.tenantId, ctx.tenantId), eq(emailSignatures.userId, ctx.userId)),
        );
    } else {
      await tx
        .insert(emailSignatures)
        .values({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          doc: input.doc,
          useOnNew: input.useOnNew,
          useOnReplies: input.useOnReplies,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [emailSignatures.tenantId, emailSignatures.userId],
          set: {
            doc: input.doc,
            useOnNew: input.useOnNew,
            useOnReplies: input.useOnReplies,
            updatedAt: now,
          },
        });
    }
    // Settings change (rules/security.md); never the signature's words.
    await audit(tx, ctx, {
      action: empty ? 'delete' : 'update',
      entityType: 'email_signature',
      entityId: ctx.userId,
      context: { useOnNew: input.useOnNew, useOnReplies: input.useOnReplies },
    });
  });
}

/* ----------------------------------------------------------------- address suggestions */

export type AddressSuggestion = { name: string; email: string };

/**
 * Contacts whose name or email starts with what is being typed in To, Cc or Bcc (ADR-091), for
 * people who may write emails. Only contacts the person may already see: `contacts.view` and its
 * record scope (own, team or all), in RLS and in the query. At most eight.
 */
export async function suggestAddresses(
  ctx: TenantContext,
  typed: string,
): Promise<AddressSuggestion[]> {
  requirePermission(ctx, 'social.reply');
  const term = typed.trim().toLowerCase();
  if (term.length < 2 || !hasPermission(ctx, 'contacts.view')) return [];
  // "%" and "_" typed are searched for, not wildcards.
  const escaped = term.replace(/[\\%_]/g, (char) => `\\${char}`);
  const rows = await withRls(ctx, (tx) =>
    tx
      .select({ name: contacts.fullName, email: contacts.emailNormalized })
      .from(contacts)
      .where(
        and(
          eq(contacts.tenantId, ctx.tenantId),
          isNull(contacts.deletedAt),
          isNotNull(contacts.emailNormalized),
          or(
            ilike(contacts.emailNormalized, `${escaped}%`),
            ilike(contacts.fullName, `${escaped}%`),
            ilike(contacts.fullName, `% ${escaped}%`),
          ),
          scopeFilter(ctx, 'contacts.view', contacts, contactScope),
        ),
      )
      .orderBy(asc(contacts.fullName))
      .limit(8),
  );
  return rows.flatMap((row) => (row.email ? [{ name: row.name ?? '', email: row.email }] : []));
}

/* --------------------------------------------------------------------------- forward */

/** "Re: Fwd: Quote" → "Fwd: Quote". */
export function forwardSubject(subject: string | null): string {
  const base = (subject ?? '').replace(/^(\s*(re|fwd?|aw|sv)\s*:\s*)+/i, '').trim();
  return `Fwd: ${base || 'your message'}`.slice(0, 200);
}

export type ForwardStart = {
  subject: string;
  doc: EmailDoc;
  attachments: { path: string; fileName: string; mimeType: string; size: number }[];
  /** Files the original had that cannot be sent from Compose (a kind email does not take). */
  skipped: number;
};

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

/**
 * An email to forward, opened in Compose (ADR-091): "Fwd:" and the subject, who it was from and
 * to, and its text with its formatting. Only a message the person may read (RLS, social.view),
 * never a private note. Its files and pictures are copied into the person's own Compose folder,
 * so the forwarded email is checked like any other and the original is never changed.
 */
export async function prepareForward(
  ctx: TenantContext,
  messageId: string,
): Promise<ForwardStart | null> {
  requirePermission(ctx, 'social.reply');
  requirePermission(ctx, 'social.view');
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({
        direction: socialMessages.direction,
        body: socialMessages.body,
        sentAt: socialMessages.sentAt,
        attachments: socialMessages.attachments,
        emailMeta: socialMessages.emailMeta,
        emailOutbound: socialMessages.emailOutbound,
        subject: socialConversations.subject,
        participantEmail: socialConversations.participantEmail,
        participantName: socialConversations.participantName,
        accountName: socialAccounts.name,
        accountAddress: socialAccounts.externalId,
      })
      .from(socialMessages)
      .innerJoin(
        socialConversations,
        and(
          eq(socialConversations.tenantId, socialMessages.tenantId),
          eq(socialConversations.id, socialMessages.conversationId),
        ),
      )
      .innerJoin(
        socialAccounts,
        and(
          eq(socialAccounts.tenantId, socialConversations.tenantId),
          eq(socialAccounts.id, socialConversations.accountId),
        ),
      )
      .where(
        and(
          eq(socialMessages.tenantId, ctx.tenantId),
          eq(socialMessages.id, messageId),
          eq(socialAccounts.platform, 'email'),
        ),
      )
      .limit(1),
  );
  if (!row || (row.direction !== 'inbound' && row.direction !== 'outbound')) return null;

  const meta = (row.emailMeta ?? {}) as { fromName?: string | null; to?: unknown; cc?: unknown };
  const composed = row.direction === 'outbound' ? readStoredCompose(row.emailOutbound) : null;
  const list = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  const from =
    row.direction === 'inbound'
      ? `${meta.fromName ?? row.participantName ?? ''} <${row.participantEmail ?? ''}>`.trim()
      : `${row.accountName} <${row.accountAddress}>`;
  const to =
    row.direction === 'inbound'
      ? list(meta.to)
      : composed?.to.length
        ? composed.to
        : [row.participantEmail ?? ''];
  const cc = row.direction === 'inbound' ? list(meta.cc) : (composed?.cc ?? []);
  const date = new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: ctx.tenant.timezone,
  }).format(row.sentAt);

  // Files and pictures, copied into the person's own folder.
  const prefix = composeFolder(ctx);
  const stored = (
    Array.isArray(row.attachments) ? (row.attachments as StoredAttachment[]) : []
  ).filter((file) => file.state === 'stored' && file.storagePath && file.mimeType);
  const copyOf = async (file: StoredAttachment) => {
    const ext =
      EXTENSIONS[file.mimeType!] ?? file.storagePath!.split('.').pop()?.slice(0, 8) ?? 'bin';
    const path = `${prefix}${randomUUID()}.${ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'}`;
    return (await copySocialMedia(file.storagePath!, path)) ? path : null;
  };
  const attachments: ForwardStart['attachments'] = [];
  let skipped = 0;
  for (const file of stored.filter((item) => !item.inline)) {
    const allowed =
      (COMPOSE_FILE_TYPES as readonly string[]).includes(file.mimeType!) &&
      (file.size ?? 0) <= MAX_COMPOSE_FILE_BYTES &&
      attachments.length < MAX_COMPOSE_FILES;
    const path = allowed ? await copyOf(file) : null;
    if (!path) {
      skipped += 1;
      continue;
    }
    attachments.push({
      path,
      fileName: file.fileName ?? `attachment.${path.split('.').pop()}`,
      mimeType: file.mimeType!,
      size: file.size ?? 0,
    });
  }
  let original: EmailDoc = composed?.doc ?? textToEmailDoc(row.body ?? '');
  if (composed) {
    const copies = new Map<string, string>();
    for (const file of stored.filter((item) => item.inline)) {
      const path = await copyOf(file);
      if (path) copies.set(file.storagePath!, path);
    }
    original = withImagePaths(original, copies);
  }
  const line = (text: string) => ({ type: 'paragraph' as const, content: [{ text }] });
  const header: EmailDoc = [
    { type: 'rule' },
    {
      type: 'paragraph',
      content: [
        { text: 'From: ', b: true },
        { text: from },
        { text: '\nSent: ', b: true },
        { text: date },
        { text: '\nTo: ', b: true },
        { text: to.join(', ') },
        ...(cc.length > 0 ? [{ text: '\nCc: ', b: true as const }, { text: cc.join(', ') }] : []),
        { text: '\nSubject: ', b: true },
        { text: row.subject ?? '' },
      ],
    },
  ];
  return {
    subject: forwardSubject(row.subject),
    doc: [line(''), ...header, ...original],
    attachments,
    skipped,
  };
}
