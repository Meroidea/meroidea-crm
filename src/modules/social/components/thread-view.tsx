'use client';

import { createBrowserClient } from '@supabase/ssr';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Paperclip,
  RotateCcw,
  Send,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useOptimistic, useRef, useState, useTransition, type ReactNode } from 'react';

import { ErrorNote } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { publicEnv } from '@/lib/env.public';
import { cn } from '@/lib/utils';
import {
  mediaReplyAction,
  replyAction,
  retryReplyAction,
  startMediaUploadAction,
} from '@/modules/social/actions';

import type { StoredAttachment } from '../media';

/** A message as the thread shows it; times arrive already in the business's timezone. */
export type ThreadItem = {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string | null;
  attachments: StoredAttachment[];
  sentAtLabel: string;
  status: string;
  error: string | null;
  sentByName: string | null;
};

const STATUS_LABELS: Record<string, { label: string; icon: typeof Check }> = {
  sending: { label: 'Sending…', icon: Clock },
  sent: { label: 'Sent', icon: Check },
  delivered: { label: 'Delivered', icon: CheckCheck },
  read: { label: 'Read', icon: CheckCheck },
};

function Attachment({
  messageId,
  index,
  attachment,
  platformLabel,
}: {
  messageId: string;
  index: number;
  attachment: StoredAttachment;
  platformLabel: string;
}) {
  const src = `/api/social/media/${messageId}/${index}`;
  if (attachment.state === 'stored') {
    const mime = attachment.mimeType ?? '';
    if (mime.startsWith('image/')) {
      return (
        <a href={src} target="_blank" rel="noopener noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element -- a one-minute signed redirect per request; nothing for the image optimiser to cache */}
          <img
            src={src}
            alt={`${attachment.type} sent by the customer`}
            loading="lazy"
            className="max-h-64 max-w-full rounded-lg object-contain"
          />
        </a>
      );
    }
    if (mime.startsWith('video/')) {
      return (
        <video controls preload="metadata" src={src} className="max-h-72 max-w-full rounded-lg" />
      );
    }
    if (mime.startsWith('audio/'))
      return <audio controls preload="metadata" src={src} className="max-w-full" />;
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 underline underline-offset-4"
      >
        <FileText aria-hidden className="size-4" /> Open the file
      </a>
    );
  }
  if (attachment.state === 'pending') {
    return <span className="text-xs opacity-80">Saving the {attachment.type}…</span>;
  }
  return (
    <span className="text-xs opacity-80">
      {attachment.type === 'sticker' ? 'A sticker' : `A ${attachment.type}`} that could not be saved
      {attachment.url ? (
        <>
          {' '}
          ·{' '}
          <a
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            open on {platformLabel}
          </a>
        </>
      ) : null}
    </span>
  );
}

/**
 * The open conversation: its messages and the reply box. A reply appears at once as "Sending…"
 * (optimistic), then the server's own record replaces it: sent, delivered and read as receipts
 * arrive, or failed with the platform's reason and a Retry button.
 */
export function ThreadView({
  conversationId,
  messages,
  platformLabel,
  canReply,
  blockedReason,
  humanAgent,
  maxChars,
  extra,
  textReply = true,
  attach = null,
}: {
  conversationId: string;
  messages: ThreadItem[];
  platformLabel: string;
  canReply: boolean;
  blockedReason: string | null;
  humanAgent: boolean;
  maxChars: number;
  /** Shown under the reply box: WhatsApp's template sender. */
  extra?: ReactNode;
  /** False when only `extra` may be sent (WhatsApp after 24 hours): no free-text box. */
  textReply?: boolean;
  /**
   * What files the platform takes in a reply (type → largest size), and whether words may go
   * with one in the same message (WhatsApp only; elsewhere they follow as a second reply).
   */
  attach?: { limits: Record<string, number>; captions: boolean; platformLabel: string } | null;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [shown, addOptimistic] = useOptimistic(messages, (current, reply: ThreadItem) => [
    ...current,
    reply,
  ]);
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [shown.length]);

  const send = (text: string) =>
    startTransition(async () => {
      setError(null);
      addOptimistic({
        id: `pending-${Date.now()}`,
        direction: 'outbound',
        body: text,
        attachments: [],
        sentAtLabel: 'Just now',
        status: 'sending',
        error: null,
        sentByName: 'You',
      });
      setBody('');
      const result = await replyAction({ conversationId, body: text });
      if (!result.ok) {
        setError(result.error.message);
        // A refused reply that reached the provider is kept as failed, with Retry.
        if (result.error.code === 'VALIDATION') setBody(text);
      }
      router.refresh();
    });

  const chooseFile = (chosen: File | null) => {
    setError(null);
    if (!chosen || !attach) return setFile(null);
    const limit = attach.limits[chosen.type];
    if (!limit) {
      setError(`${attach.platformLabel} does not take this kind of file from here.`);
    } else if (chosen.size > limit) {
      setError(
        `${attach.platformLabel} takes files of this kind up to ${Math.round(limit / 1048576)} MB.`,
      );
    } else {
      setFile(chosen);
      return;
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  /**
   * Sends the attached file (ADR-067): the server hands out a one-time ticket for a path it
   * chose, the browser uploads straight to private storage, and the server checks the file
   * before sending it. Words go with it on WhatsApp, as a second reply elsewhere.
   */
  const sendFile = (chosen: File, text: string) =>
    startTransition(async () => {
      setError(null);
      const kind = chosen.type.startsWith('image/')
        ? 'image'
        : chosen.type.startsWith('video/')
          ? 'video'
          : chosen.type.startsWith('audio/')
            ? 'audio'
            : 'file';
      addOptimistic({
        id: `pending-${Date.now()}`,
        direction: 'outbound',
        body: attach?.captions ? text || null : null,
        attachments: [{ type: kind, state: 'pending' }],
        sentAtLabel: 'Just now',
        status: 'sending',
        error: null,
        sentByName: 'You',
      });
      setFile(null);
      setBody('');
      if (fileInput.current) fileInput.current.value = '';
      const ticket = await startMediaUploadAction({
        conversationId,
        fileName: chosen.name,
        mimeType: chosen.type,
        size: chosen.size,
      });
      if (!ticket.ok) {
        setError(ticket.error.message);
        setBody(text);
        return router.refresh();
      }
      const storage = createBrowserClient(
        publicEnv.supabaseUrl,
        publicEnv.supabasePublishableKey,
      ).storage.from('social-media');
      const uploaded = await storage.uploadToSignedUrl(
        ticket.data.path,
        ticket.data.token,
        chosen,
        {
          contentType: chosen.type,
        },
      );
      if (uploaded.error) {
        setError('The upload did not complete. Try again.');
        setBody(text);
        return router.refresh();
      }
      const sent = await mediaReplyAction({
        conversationId,
        path: ticket.data.path,
        mimeType: chosen.type,
        fileName: chosen.name,
        caption: attach?.captions ? text || undefined : undefined,
      });
      if (!sent.ok) setError(sent.error.message);
      else if (text && !attach?.captions) {
        const words = await replyAction({ conversationId, body: text });
        if (!words.ok) setError(words.error.message);
      }
      router.refresh();
    });

  const submit = () => {
    const text = body.trim();
    if (file) sendFile(file, text);
    else if (text) send(text);
  };

  const retry = (messageId: string) =>
    startTransition(async () => {
      setError(null);
      const result = await retryReplyAction({ messageId });
      if (!result.ok) setError(result.error.message);
      router.refresh();
    });

  return (
    <div className="flex flex-1 flex-col gap-3">
      <ol
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1 lg:min-h-24"
        aria-label="Messages"
        aria-live="polite"
      >
        {shown.length === 0 && <li className="text-sm text-muted-foreground">No messages yet.</li>}
        {shown.map((message) => {
          const outbound = message.direction === 'outbound';
          const status = STATUS_LABELS[message.status];
          return (
            <li
              key={message.id}
              className={cn('flex flex-col gap-1', outbound ? 'items-end' : 'items-start')}
            >
              <div
                className={cn(
                  'flex max-w-[85%] flex-col gap-2 rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap',
                  outbound ? 'bg-primary text-primary-foreground' : 'border bg-card',
                  message.status === 'sending' && 'opacity-70',
                  message.status === 'failed' &&
                    'border border-destructive bg-destructive/10 text-foreground',
                )}
                data-sensitive
              >
                {message.body && <span>{message.body}</span>}
                {message.attachments.map((attachment, index) => (
                  <Attachment
                    key={index}
                    messageId={message.id}
                    index={index}
                    attachment={attachment}
                    platformLabel={platformLabel}
                  />
                ))}
              </div>
              <p
                className={cn(
                  'flex flex-wrap items-center gap-1 text-xs text-muted-foreground',
                  outbound && 'justify-end text-right',
                )}
              >
                {outbound ? (
                  <span>{message.sentByName ?? `from the ${platformLabel} app`} ·</span>
                ) : (
                  <span>{platformLabel} ·</span>
                )}
                <span>{message.sentAtLabel}</span>
                {status && (
                  <span className="flex items-center gap-0.5">
                    ·{' '}
                    <status.icon
                      aria-hidden
                      className={cn('size-3', message.status === 'read' && 'text-primary')}
                    />
                    {status.label}
                  </span>
                )}
                {message.status === 'failed' && (
                  <span className="flex items-center gap-1 text-destructive-text">
                    <AlertTriangle aria-hidden className="size-3" /> Not sent
                    {message.error ? `: ${message.error}` : ''}
                    {canReply && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        disabled={isPending}
                        onClick={() => retry(message.id)}
                      >
                        <RotateCcw aria-hidden className="size-3" /> Retry
                      </Button>
                    )}
                  </span>
                )}
              </p>
            </li>
          );
        })}
        <li ref={end} aria-hidden />
      </ol>

      {canReply &&
        textReply &&
        (blockedReason ? (
          <p className="rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">
            {blockedReason}
          </p>
        ) : (
          <form
            className="flex flex-col gap-2 rounded-xl border bg-card p-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            {file && (
              <p className="flex w-fit max-w-full items-center gap-2 rounded-lg border bg-muted/40 px-2 py-1 text-sm">
                <Paperclip aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label="Remove the attachment"
                  onClick={() => chooseFile(null)}
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </p>
            )}
            <Textarea
              aria-label="Reply to the customer"
              placeholder={
                file
                  ? attach?.captions
                    ? 'Add a caption (optional)…'
                    : 'Add words to send after the file (optional)…'
                  : 'Write your reply…'
              }
              rows={2}
              required={!file}
              maxLength={maxChars}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter starts a new line, as in the platforms' own apps.
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground tabular-nums">
                {humanAgent
                  ? 'Sent as a reply from a person: more than 24 hours have passed since their last message.'
                  : `${body.length} / ${maxChars}`}
              </p>
              <div className="flex items-center gap-1.5">
                {attach && (
                  <>
                    <input
                      ref={fileInput}
                      type="file"
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden
                      accept={Object.keys(attach.limits).join(',')}
                      onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Attach a photo or file"
                      disabled={isPending}
                      onClick={() => fileInput.current?.click()}
                    >
                      <Paperclip aria-hidden />
                    </Button>
                  </>
                )}
                <Button type="submit" size="sm" disabled={!file && body.trim().length === 0}>
                  <Send aria-hidden /> Send
                </Button>
              </div>
            </div>
          </form>
        ))}
      {canReply && extra && (
        // On a wide screen the thread has a fixed height: a tall template form scrolls in place
        // instead of spilling over the page.
        <div className="shrink-0 lg:max-h-[45dvh] lg:overflow-y-auto">{extra}</div>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
