import { Mail } from 'lucide-react';
import { notFound } from 'next/navigation';

import { getDraft, getSignature, prepareForward } from '@/modules/social/compose-service';
import { EmailCompose, type ComposeStart } from '@/modules/social/components/email-compose';
import type { EmailDoc } from '@/modules/social/email-doc';
import { EmailList } from '@/modules/social/components/email-list';
import { InboxRealtime } from '@/modules/social/components/inbox-realtime';
import { listConversations } from '@/modules/social/queries';
import { inboxFiltersSchema } from '@/modules/social/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

import { EmailWorkspace } from './email-workspace';
import { areaSettings, areaSwitchedOn, loadInboxArea } from './inbox-area';

/**
 * Compose (ADR-090): a new email in the reading pane, with the folders and the list beside it as
 * a desktop mail client shows them. On a phone it takes the screen.
 */
export async function ComposeScreen({
  query,
}: {
  query: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'social.view');
  if (!areaSwitchedOn(ctx.tenant.features, 'email')) notFound();
  const filters = inboxFiltersSchema.parse(query);
  const [{ rows, nextCursor }, area] = await Promise.all([
    listConversations(ctx, filters, 'email'),
    loadInboxArea(ctx, 'email'),
  ]);
  if (area.area.kind !== 'email') notFound();
  const canCompose = area.newEmailFrom.length > 0;
  const start = canCompose ? await composeStart(ctx, query) : {};

  return (
    <EmailWorkspace
      filters={filters}
      unread={area.area.unread}
      mailboxLabel={area.mailboxLabel}
      settings={areaSettings(ctx, 'email', area.area)}
      actions={<InboxRealtime tenantId={ctx.tenantId} />}
      canCompose={canCompose}
      drafts={area.drafts}
      meroAI={area.meroAI}
      reading
      list={
        <EmailList
          rows={rows}
          filters={filters}
          nextCursor={nextCursor}
          hasAccounts={area.hasAccounts}
          canManage={hasPermission(ctx, 'social.manage')}
          canReply={hasPermission(ctx, 'social.reply')}
          timeZone={ctx.tenant.timezone}
        />
      }
    >
      {canCompose ? (
        <EmailCompose
          // A different draft or forward is a different email: start the form afresh.
          key={
            typeof query.draft === 'string'
              ? query.draft
              : typeof query.forward === 'string'
                ? `forward-${query.forward}`
                : 'new'
          }
          inboxes={area.newEmailFrom}
          start={start}
          timeZone={ctx.tenant.timezone}
          meroAI={area.meroAI}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card/50 p-6 text-center text-sm text-muted-foreground">
          <Mail aria-hidden className="size-8" />
          {area.hasAccounts
            ? 'Your role cannot send emails. Ask an admin if you need to.'
            : 'Create your email inbox address first: emails are sent from it.'}
        </div>
      )}
    </EmailWorkspace>
  );
}

const BLANK_LINE: EmailDoc[number] = { type: 'paragraph', content: [] };

/**
 * What Compose opens with (ADR-091): a draft of the person's own, as it was saved; otherwise an
 * empty email with their signature below two empty lines, when they use it on new emails.
 */
async function composeStart(
  ctx: Parameters<typeof getDraft>[0],
  query: Record<string, string | string[] | undefined>,
): Promise<ComposeStart> {
  const draftId = typeof query.draft === 'string' ? query.draft : null;
  if (draftId && /^[0-9a-f-]{36}$/.test(draftId)) {
    const [draft, signature] = await Promise.all([getDraft(ctx, draftId), getSignature(ctx)]);
    if (!draft) notFound();
    return {
      signature: signature?.useOnNew ? signature.doc : null,
      draftId: draft.id,
      accountId: draft.accountId,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      doc: draft.doc,
      attachments: draft.attachments,
    };
  }
  const signature = await getSignature(ctx);
  const forwardId = typeof query.forward === 'string' ? query.forward : null;
  if (forwardId && /^[0-9a-f-]{36}$/.test(forwardId)) {
    const forward = await prepareForward(ctx, forwardId);
    if (!forward) notFound();
    // As a mail program forwards: room to write, the signature, then the forwarded email.
    const signed = signature?.useOnReplies ? [BLANK_LINE, ...signature.doc] : [];
    return {
      signature: signature?.useOnReplies ? signature.doc : null,
      subject: forward.subject,
      doc: [BLANK_LINE, ...signed, ...forward.doc],
      attachments: forward.attachments,
      notice:
        forward.skipped > 0
          ? `${forward.skipped} file${forward.skipped === 1 ? '' : 's'} could not be forwarded: Compose sends images, PDF and Office files up to 10 MB.`
          : undefined,
    };
  }
  return signature?.useOnNew
    ? { doc: [BLANK_LINE, BLANK_LINE, ...signature.doc], signature: signature.doc }
    : {};
}
