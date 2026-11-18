import { AlertTriangle, ArrowLeft, Paperclip } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  AutoRefresh,
  ContactLinker,
  MarkRead,
  ReplyBox,
  StatusButton,
} from '@/modules/social/components/social-tools';
import { ACCOUNT_STATUS_LABELS, customerLabel, PLATFORM_LABELS } from '@/modules/social/format';
import { getConversation } from '@/modules/social/queries';
import { REPLY_RULES, replyWindow } from '@/modules/social/service';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Conversation' };

export default async function ConversationPage({ params }: PageProps<'/social/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'social.view');
  const parsed = z.object({ id: z.uuid() }).safeParse(await params);
  const thread = parsed.success ? await getConversation(ctx, parsed.data.id) : null;
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
  const contactLabel = ctx.tenant.labels.contact.singular;

  return (
    <div className="flex w-full max-w-5xl flex-col gap-5">
      <AutoRefresh />
      <MarkRead conversationId={conversation.id} unread={conversation.unreadCount} />
      <Link
        href="/social"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> Social inbox
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance" data-sensitive>
          {name}
        </h1>
        <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <Badge variant="outline">{PLATFORM_LABELS[platform]}</Badge>
          {conversation.participantUsername && conversation.participantName && (
            <span data-sensitive>@{conversation.participantUsername}</span>
          )}
          <span>· to {thread.accountName}</span>
          {conversation.status === 'done' && <Badge variant="secondary">Done</Badge>}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_17rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <ol className="flex flex-col gap-2" aria-label="Messages">
            {thread.messages.length === 0 && (
              <li className="text-sm text-muted-foreground">No messages yet.</li>
            )}
            {thread.messages.map((message) => {
              const outbound = message.direction === 'outbound';
              return (
                <li
                  key={message.id}
                  className={cn('flex flex-col gap-1', outbound ? 'items-end' : 'items-start')}
                >
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap',
                      outbound ? 'bg-primary text-primary-foreground' : 'border bg-card',
                      message.status === 'failed' &&
                        'border border-destructive bg-destructive/10 text-foreground',
                    )}
                    data-sensitive
                  >
                    {message.body}
                    {message.attachments.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-2">
                        {message.attachments.map((attachment, index) =>
                          attachment.url ? (
                            <a
                              key={index}
                              href={attachment.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 underline underline-offset-4"
                            >
                              <Paperclip aria-hidden className="size-3.5" /> {attachment.type}
                            </a>
                          ) : (
                            <span key={index} className="inline-flex items-center gap-1 opacity-80">
                              <Paperclip aria-hidden className="size-3.5" /> {attachment.type}
                            </span>
                          ),
                        )}
                      </span>
                    )}
                  </div>
                  <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {outbound && (
                      <span>
                        {message.sentByName ?? `from the ${PLATFORM_LABELS[platform]} app`} ·
                      </span>
                    )}
                    <time dateTime={message.sentAt.toISOString()}>
                      {formatDateTime(ctx, message.sentAt)}
                    </time>
                    {message.status === 'sending' && <span>· sending…</span>}
                    {message.status === 'failed' && (
                      <span className="flex items-center gap-1 text-destructive-text">
                        <AlertTriangle aria-hidden className="size-3" /> Not sent
                        {message.error ? `: ${message.error}` : ''}
                      </span>
                    )}
                  </p>
                </li>
              );
            })}
          </ol>
          {canReply && (
            <ReplyBox
              conversationId={conversation.id}
              maxChars={REPLY_RULES[platform].maxChars}
              blockedReason={blockedReason}
              humanAgent={window.ok && window.humanAgent}
            />
          )}
        </div>

        <aside className="flex flex-col gap-4">
          {canReply && hasPermission(ctx, 'contacts.view') && (
            <section className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm">
              <h2 className="font-medium">{contactLabel}</h2>
              <ContactLinker
                conversationId={conversation.id}
                contactId={conversation.contactId}
                contactName={thread.contactName}
                contactLabel={contactLabel}
              />
            </section>
          )}
          {canReply && (
            <section className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm">
              <h2 className="font-medium">Conversation</h2>
              <StatusButton conversationId={conversation.id} status={conversation.status} />
            </section>
          )}
          <section className="flex flex-col gap-1.5 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
            <h2 className="font-medium text-foreground">Account</h2>
            <p>{thread.accountName}</p>
            <p>
              {
                ACCOUNT_STATUS_LABELS[
                  thread.accountDisconnectedAt ? 'disconnected' : thread.accountStatus
                ]
              }
            </p>
            {conversation.lastInboundAt && (
              <p>Customer last wrote {formatDateTime(ctx, conversation.lastInboundAt)}</p>
            )}
            <p className="text-xs">
              {platform === 'tiktok'
                ? 'TikTok allows up to 10 replies within 48 hours of the customer’s last message.'
                : 'Replies are allowed within 24 hours of the customer’s last message, or 7 days as a reply from a person.'}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
