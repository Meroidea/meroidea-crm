import { notFound } from 'next/navigation';

import { MeroAIInbox } from '@/modules/ai/components/meroai-email';
import { EmailList } from '@/modules/social/components/email-list';
import { InboxRealtime } from '@/modules/social/components/inbox-realtime';
import { listConversations } from '@/modules/social/queries';
import { inboxFiltersSchema } from '@/modules/social/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

import { EmailWorkspace } from './email-workspace';
import { areaSettings, areaSwitchedOn, loadInboxArea } from './inbox-area';

/**
 * Ask MeroAI about the inbox (ADR-092), in the reading pane beside the folders and the list.
 * Not offered, and not found, when MeroAI is not available to this person.
 */
export async function MeroAIInboxScreen({
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
  if (area.area.kind !== 'email' || !area.meroAI) notFound();

  return (
    <EmailWorkspace
      filters={filters}
      unread={area.area.unread}
      mailboxLabel={area.mailboxLabel}
      settings={areaSettings(ctx, 'email', area.area)}
      actions={<InboxRealtime tenantId={ctx.tenantId} />}
      canCompose={area.newEmailFrom.length > 0}
      drafts={area.drafts}
      meroAI
      inMeroAI
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
      <MeroAIInbox />
    </EmailWorkspace>
  );
}
