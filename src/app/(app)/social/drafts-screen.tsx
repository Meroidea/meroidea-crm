import { FilePenLine } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EmptyState } from '@/components/data/empty-state';
import { formatRelative } from '@/lib/format';
import { listDrafts } from '@/modules/social/compose-service';
import { InboxRealtime } from '@/modules/social/components/inbox-realtime';
import { inboxFiltersSchema } from '@/modules/social/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

import { EmailWorkspace } from './email-workspace';
import { areaSettings, areaSwitchedOn, loadInboxArea } from './inbox-area';

/** The person's own drafts (ADR-091), latest first; one opens again in Compose. */
export async function DraftsScreen() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'social.view');
  if (!areaSwitchedOn(ctx.tenant.features, 'email') || !hasPermission(ctx, 'social.reply')) {
    notFound();
  }
  const [area, drafts] = await Promise.all([loadInboxArea(ctx, 'email'), listDrafts(ctx)]);
  if (area.area.kind !== 'email') notFound();

  return (
    <EmailWorkspace
      filters={inboxFiltersSchema.parse({})}
      unread={area.area.unread}
      mailboxLabel={area.mailboxLabel}
      settings={areaSettings(ctx, 'email', area.area)}
      actions={<InboxRealtime tenantId={ctx.tenantId} />}
      canCompose={area.newEmailFrom.length > 0}
      drafts={area.drafts}
      meroAI={area.meroAI}
      inDrafts
      list={
        <section
          aria-labelledby="drafts-title"
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card"
        >
          <h2 id="drafts-title" className="border-b px-4 py-3 text-sm font-semibold">
            Drafts
          </h2>
          {drafts.length === 0 ? (
            <EmptyState
              icon={FilePenLine}
              title="No drafts"
              description="An email you start is saved here as you write, until you send or discard it."
            />
          ) : (
            <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
              {drafts.map((draft) => (
                <li key={draft.id}>
                  <Link
                    href={`/email/compose?draft=${draft.id}`}
                    className="flex flex-col gap-0.5 px-4 py-3 hover:bg-muted/50"
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm text-destructive-text">
                        [Draft]{' '}
                        <span className="text-foreground" data-sensitive>
                          {draft.to.join(', ') || 'No recipients yet'}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatRelative(draft.updatedAt)}
                      </span>
                    </span>
                    <span className="truncate text-sm" data-sensitive>
                      {draft.subject || '(no subject)'}
                    </span>
                    <span className="truncate text-xs text-muted-foreground" data-sensitive>
                      {draft.preview || 'No text yet'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      }
    >
      <div className="hidden h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card/50 text-center text-sm text-muted-foreground lg:flex">
        <FilePenLine aria-hidden className="size-8" />
        Choose a draft to keep writing.
      </div>
    </EmailWorkspace>
  );
}
