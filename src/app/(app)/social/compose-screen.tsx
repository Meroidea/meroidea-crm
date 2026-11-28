import { Mail } from 'lucide-react';
import { notFound } from 'next/navigation';

import { EmailCompose } from '@/modules/social/components/email-compose';
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

  return (
    <EmailWorkspace
      filters={filters}
      unread={area.area.unread}
      mailboxLabel={area.mailboxLabel}
      settings={areaSettings(ctx, 'email', area.area)}
      actions={<InboxRealtime tenantId={ctx.tenantId} />}
      canCompose={canCompose}
      reading
      list={
        <EmailList
          rows={rows}
          filters={filters}
          nextCursor={nextCursor}
          hasAccounts={area.hasAccounts}
          canManage={hasPermission(ctx, 'social.manage')}
          timeZone={ctx.tenant.timezone}
        />
      }
    >
      {canCompose ? (
        <EmailCompose inboxes={area.newEmailFrom} />
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
