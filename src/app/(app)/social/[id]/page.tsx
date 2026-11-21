import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { withParams } from '@/components/data/url';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import { InboxList } from '@/modules/social/components/inbox-list';
import { InboxRealtime } from '@/modules/social/components/inbox-realtime';
import { CustomerAvatar, PlatformBadge } from '@/modules/social/components/platform-badge';
import { ContactLinker, MarkRead, StatusButton } from '@/modules/social/components/social-tools';
import { TemplateReply } from '@/modules/social/components/template-reply';
import { ThreadView } from '@/modules/social/components/thread-view';
import { ACCOUNT_STATUS_LABELS, customerLabel, PLATFORM_LABELS } from '@/modules/social/format';
import {
  countUnread,
  getConversation,
  listAccounts,
  listConversations,
  sendableTemplates,
} from '@/modules/social/queries';
import { inboxFiltersSchema } from '@/modules/social/schemas';
import { REPLY_RULES, replyWindow } from '@/modules/social/service';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Conversation' };

export default async function ConversationPage({
  params,
  searchParams,
}: PageProps<'/social/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'social.view');
  const parsed = z.object({ id: z.uuid() }).safeParse(await params);
  const filters = inboxFiltersSchema.parse(await searchParams);
  const [thread, list, unread, { accounts }] = await Promise.all([
    parsed.success ? getConversation(ctx, parsed.data.id) : null,
    listConversations(ctx, filters),
    countUnread(ctx),
    listAccounts(ctx),
  ]);
  if (!thread) notFound();

  const { conversation, platform } = thread;
  const name = customerLabel({ ...conversation, platform });
  const canReply = hasPermission(ctx, 'social.reply');
  const window = replyWindow(platform, conversation.lastInboundAt);
  const accountLive = !thread.accountDisconnectedAt && thread.accountStatus === 'active';
  const blockedReason = !accountLive
    ? thread.accountDisconnectedAt
      ? 'This account is disconnected. Connect it again to reply.'
      : 'This account needs to be connected again before you can reply.'
    : window.ok
      ? null
      : window.reason;
  // WhatsApp: an approved template may be sent at any time, the only option after 24 hours.
  const templates =
    platform === 'whatsapp' && canReply && accountLive
      ? await sendableTemplates(ctx, thread.accountId)
      : [];
  const templateOnly = platform === 'whatsapp' && accountLive && !window.ok;
  const contactLabel = ctx.tenant.labels.contact.singular;
  const back = withParams('/social', { view: filters.view, platform: filters.platform }, {});

  return (
    <div className="flex w-full max-w-7xl flex-col gap-4">
      <MarkRead conversationId={conversation.id} unread={conversation.unreadCount} />
      <div className="flex items-center justify-between gap-3">
        <Link
          href={back}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" /> Social inbox
        </Link>
        <InboxRealtime tenantId={ctx.tenantId} />
      </div>

      <div className="grid gap-4 lg:h-[calc(100dvh-10rem)] lg:min-h-[32rem] lg:grid-cols-[22rem_1fr]">
        <div className="hidden min-h-0 lg:flex">
          <InboxList
            rows={list.rows}
            filters={filters}
            nextCursor={list.nextCursor}
            unread={unread}
            platforms={[...new Set(accounts.map((account) => account.platform))]}
            activeId={conversation.id}
            hasAccounts={accounts.length > 0}
            canManage={hasPermission(ctx, 'social.manage')}
          />
        </div>

        <section
          aria-label={`Conversation with ${name}`}
          className="flex min-h-[70dvh] min-w-0 flex-col gap-3 rounded-xl border bg-card p-3 sm:p-4 lg:min-h-0 lg:overflow-y-auto"
        >
          <header className="flex flex-wrap items-start gap-3 border-b pb-3">
            <CustomerAvatar
              conversationId={conversation.id}
              name={name}
              hasPicture={conversation.participantAvatarPath !== null}
              className="size-10 text-sm"
            />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold tracking-tight" data-sensitive>
                {name}
              </h1>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <PlatformBadge platform={platform} />
                {conversation.participantUsername && conversation.participantName && (
                  <span data-sensitive>@{conversation.participantUsername}</span>
                )}
                {conversation.participantPhone && conversation.participantName && (
                  <span data-sensitive>+{conversation.participantPhone}</span>
                )}
                <span>to {thread.accountName}</span>
                {!accountLive && (
                  <Badge variant="destructive">
                    {
                      ACCOUNT_STATUS_LABELS[
                        thread.accountDisconnectedAt ? 'disconnected' : thread.accountStatus
                      ]
                    }
                  </Badge>
                )}
                {conversation.lastInboundAt && (
                  <span>Last wrote {formatDateTime(ctx, conversation.lastInboundAt)}</span>
                )}
              </div>
            </div>
            {canReply && (
              <StatusButton conversationId={conversation.id} status={conversation.status} />
            )}
            {canReply && hasPermission(ctx, 'contacts.view') && (
              <div className="w-full sm:max-w-xs">
                <ContactLinker
                  conversationId={conversation.id}
                  contactId={conversation.contactId}
                  contactName={thread.contactName}
                  contactLabel={contactLabel}
                />
              </div>
            )}
          </header>

          <ThreadView
            conversationId={conversation.id}
            platformLabel={PLATFORM_LABELS[platform]}
            canReply={canReply}
            blockedReason={templateOnly ? null : blockedReason}
            textReply={!templateOnly}
            humanAgent={window.ok && window.humanAgent}
            maxChars={REPLY_RULES[platform].maxChars}
            extra={
              platform === 'whatsapp' && accountLive ? (
                window.ok ? (
                  <details className="rounded-xl border bg-card p-3 text-sm">
                    <summary className="cursor-pointer font-medium">
                      Send a template instead
                    </summary>
                    <div className="mt-3">
                      <TemplateReply
                        conversationId={conversation.id}
                        templates={templates}
                        canManage={hasPermission(ctx, 'social.manage')}
                      />
                    </div>
                  </details>
                ) : (
                  <div className="rounded-xl border bg-card p-3">
                    <TemplateReply
                      conversationId={conversation.id}
                      templates={templates}
                      canManage={hasPermission(ctx, 'social.manage')}
                      notice={window.ok ? undefined : window.reason}
                    />
                  </div>
                )
              ) : null
            }
            messages={thread.messages.map((message) => ({
              id: message.id,
              direction: message.direction,
              body: message.body,
              attachments: message.attachments,
              sentAtLabel: formatDateTime(ctx, message.sentAt),
              status: message.status,
              error: message.error,
              sentByName: message.sentByName,
            }))}
          />
          <p className={templateOnly ? 'hidden' : 'text-xs text-muted-foreground'}>
            {platform === 'tiktok'
              ? 'TikTok allows up to 10 replies within 48 hours of the customer’s last message.'
              : platform === 'whatsapp'
                ? 'Free-form replies within 24 hours of the customer’s last message; after that, an approved template. Meta charges for templates and for replies beyond 1,000 a month.'
                : 'Replies are allowed within 24 hours of the customer’s last message, or 7 days as a reply from a person.'}
          </p>
        </section>
      </div>
    </div>
  );
}
