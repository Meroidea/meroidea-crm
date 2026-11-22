import { MessagesSquare, Settings2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/data/page-header';
import { Button } from '@/components/ui/button';
import { InboxList } from '@/modules/social/components/inbox-list';
import { InboxRealtime } from '@/modules/social/components/inbox-realtime';
import { countUnread, listAccounts, listConversations } from '@/modules/social/queries';
import { inboxFiltersSchema } from '@/modules/social/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Inbox' };

export default async function SocialInboxPage({ searchParams }: PageProps<'/social'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'social.view');
  const filters = inboxFiltersSchema.parse(await searchParams);
  const [{ rows, nextCursor }, unread, { accounts }] = await Promise.all([
    listConversations(ctx, filters),
    countUnread(ctx),
    listAccounts(ctx),
  ]);
  const canManage = hasPermission(ctx, 'social.manage');

  return (
    <div className="flex w-full max-w-7xl flex-col gap-4">
      <PageHeader
        title="Inbox"
        description="Messages from customers on your connected email, WhatsApp, Facebook, Instagram and TikTok accounts."
        actions={
          <>
            <InboxRealtime tenantId={ctx.tenantId} />
            {canManage && (
              <Button asChild variant="outline">
                <Link href="/social/accounts">
                  <Settings2 aria-hidden /> Connected accounts
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:h-[calc(100dvh-12rem)] lg:min-h-[32rem] lg:grid-cols-[22rem_1fr]">
        <InboxList
          rows={rows}
          filters={filters}
          nextCursor={nextCursor}
          unread={unread}
          platforms={[...new Set(accounts.map((account) => account.platform))]}
          hasAccounts={accounts.length > 0}
          canManage={canManage}
        />
        <div className="hidden flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card/50 text-center text-sm text-muted-foreground lg:flex">
          <MessagesSquare aria-hidden className="size-8" />
          Choose a conversation to read and reply.
        </div>
      </div>
    </div>
  );
}
