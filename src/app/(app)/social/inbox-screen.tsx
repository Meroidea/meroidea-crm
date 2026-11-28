import { ChevronDown, Mail, MessagesSquare, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/data/page-header';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmailList } from '@/modules/social/components/email-list';
import { InboxList } from '@/modules/social/components/inbox-list';
import { InboxRealtime } from '@/modules/social/components/inbox-realtime';
import type { Mailbox } from '@/modules/social/providers/types';
import { listConversations } from '@/modules/social/queries';
import { inboxFiltersSchema } from '@/modules/social/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

import { areaSettings, areaSwitchedOn, loadInboxArea } from './inbox-area';
import { EmailWorkspace } from './email-workspace';

/**
 * An area's list with an empty reading pane (ADR-073): the Social inbox (social media and website
 * chat) or Email. Each keeps its own settings in a menu on its header.
 */
export async function InboxScreen({
  query,
  mailbox,
}: {
  query: Record<string, string | string[] | undefined>;
  mailbox: Mailbox;
}) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'social.view');
  if (!areaSwitchedOn(ctx.tenant.features, mailbox)) notFound();
  const filters = inboxFiltersSchema.parse(query);
  const [{ rows, nextCursor }, area] = await Promise.all([
    listConversations(ctx, filters, mailbox),
    loadInboxArea(ctx, mailbox),
  ]);
  const canManage = hasPermission(ctx, 'social.manage');
  const settings = areaSettings(ctx, mailbox, area.area);

  if (mailbox === 'email' && area.area.kind === 'email') {
    return (
      <EmailWorkspace
        filters={filters}
        unread={area.area.unread}
        mailboxLabel={area.mailboxLabel}
        settings={settings}
        actions={<InboxRealtime tenantId={ctx.tenantId} />}
        canCompose={area.newEmailFrom.length > 0}
        drafts={area.drafts}
        meroAI={area.meroAI}
        list={
          <EmailList
            rows={rows}
            filters={filters}
            nextCursor={nextCursor}
            hasAccounts={area.hasAccounts}
            canManage={canManage}
            canReply={hasPermission(ctx, 'social.reply')}
            timeZone={ctx.tenant.timezone}
          />
        }
      >
        <div className="hidden h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card/50 text-center text-sm text-muted-foreground lg:flex">
          <Mail aria-hidden className="size-8" />
          Choose an email to read and reply.
        </div>
      </EmailWorkspace>
    );
  }

  return (
    <div className="flex w-full max-w-7xl flex-col gap-4">
      <PageHeader
        title={mailbox === 'email' ? 'Email' : 'Social inbox'}
        description={
          mailbox === 'email'
            ? 'Email between your business and its customers. People who are not contacts yet wait in To review.'
            : 'Customers’ messages from Facebook, Instagram, WhatsApp, TikTok and your website chat, in one list.'
        }
        actions={
          <>
            <InboxRealtime tenantId={ctx.tenantId} />
            {settings.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Settings2 aria-hidden /> Settings <ChevronDown aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {settings.map((item) => (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link href={item.href}>{item.label}</Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:h-[calc(100dvh-12rem)] lg:min-h-[32rem] lg:grid-cols-[22rem_1fr]">
        <InboxList
          area={area.area}
          rows={rows}
          filters={filters}
          nextCursor={nextCursor}
          hasAccounts={area.hasAccounts}
          canManage={canManage}
        />
        <div className="hidden flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card/50 text-center text-sm text-muted-foreground lg:flex">
          {mailbox === 'email' ? (
            <Mail aria-hidden className="size-8" />
          ) : (
            <MessagesSquare aria-hidden className="size-8" />
          )}
          {mailbox === 'email'
            ? 'Choose an email thread to read and reply.'
            : 'Choose a conversation to read and reply.'}
        </div>
      </div>
    </div>
  );
}
