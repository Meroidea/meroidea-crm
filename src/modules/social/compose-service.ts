import 'server-only';

import { and, asc, count, desc, eq, ilike, isNotNull, isNull, or } from 'drizzle-orm';

import { contacts, emailDrafts, emailSignatures, socialAccounts } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { scopeFilter } from '@/lib/permissions/scope';
import { contactScope } from '@/modules/contacts/access';
import { audit } from '@/server/audit';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';
import { removeSocialMedia } from '@/server/storage';

import { emailDocDraftSchema, emailDocImagePaths, emailDocText, type EmailDoc } from './email-doc';
import { emailDraftSchema, type EmailDraftInput, type EmailSignatureInput } from './schemas';

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
