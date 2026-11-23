'use client';

import { createBrowserClient } from '@supabase/ssr';
import {
  AlertTriangle,
  BookmarkPlus,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Lock,
  MessageSquareText,
  Paperclip,
  RotateCcw,
  Send,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useOptimistic, useRef, useState, useTransition, type ReactNode } from 'react';

import { useAppearHaptic } from '@/components/haptics/haptics-provider';
import { ErrorNote } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { publicEnv } from '@/lib/env.public';
import { cn } from '@/lib/utils';
import {
  mediaReplyAction,
  noteAction,
  replyAction,
  retryReplyAction,
  startMediaUploadAction,
} from '@/modules/social/actions';

import { ArticlePicker } from '@/modules/kb/components/article-picker';

import { findCanned } from '../canned';
import type { StoredAttachment } from '../media';
import { PresenceNote, useConversationPresence, type PresenceSetup } from './conversation-presence';

/** A message as the thread shows it; times arrive already in the business's timezone. */
export type ThreadItem = {
  id: string;
  /** `note`: a private note between colleagues, never sent (ADR-068). */
  direction: 'inbound' | 'outbound' | 'note';
  body: string | null;
  attachments: StoredAttachment[];
  sentAtLabel: string;
  status: string;
  error: string | null;
  sentByName: string | null;
  /** Email (ADR-070): the sender failed DKIM and DMARC, so their address may be forged. */
  unverified?: boolean;
  /** Email: sent by a machine (an auto-reply or a bounce). */
  automated?: boolean;
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
  canned = [],
  presence = null,
  articles = false,
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
  /** Saved replies, placeholders already filled in for this customer and agent. */
  canned?: { id: string; title: string; shortcut: string | null; body: string; shared: boolean }[];
  /** Who else is on this conversation (Realtime Presence); null without it. */
  presence?: PresenceSetup | null;
  /** Whether help articles can be linked from the reply box (ADR-071). */
  articles?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  const [picker, setPicker] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const others = useConversationPresence(presence, conversationId, typing);
  // "Typing" while keys are pressed, and for a few seconds after.
  const markTyping = () => {
    setTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 4000);
  };
  useEffect(() => () => clearTimeout(typingTimer.current), []);
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
  // A customer's new message arriving live (ADR-065) is felt, not just seen (ADR-073).
  useAppearHaptic(messages.filter((message) => message.direction === 'inbound').length, {
    resetKey: conversationId,
    element: () => end.current?.previousElementSibling ?? null,
  });

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

  const saveNote = (text: string) =>
    startTransition(async () => {
      setError(null);
      addOptimistic({
        id: `pending-${Date.now()}`,
        direction: 'note',
        body: text,
        attachments: [],
        sentAtLabel: 'Just now',
        status: 'sent',
        error: null,
        sentByName: 'You',
      });
      setNote('');
      setTyping(false);
      const result = await noteAction({ conversationId, body: text });
      if (!result.ok) {
        setError(result.error.message);
        setNote(text);
      }
      router.refresh();
    });

  /** Puts a saved reply into the box: in place of a typed "/shortcut", or after what is there. */
  const insertCanned = (text: string) => {
    const current = mode === 'note' ? note : body;
    const next = current.startsWith('/') ? text : current ? `${current.trimEnd()}\n${text}` : text;
    if (mode === 'note') setNote(next);
    else setBody(next);
    setPicker(null);
  };
  const onComposerChange = (value: string) => {
    if (mode === 'note') setNote(value);
    else setBody(value);
    markTyping();
    // "/" at the start looks up saved replies by shortcut or title.
    if (canned.length > 0 && value.startsWith('/') && !value.includes('\n')) {
      setPicker(value.slice(1));
    } else if (picker !== null && !value.startsWith('/')) {
      setPicker(null);
    }
  };
  const matches = picker === null ? [] : findCanned(canned, picker).slice(0, 8);

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
    setPicker(null);
    if (mode === 'note') {
      const text = note.trim();
      if (text) saveNote(text);
      return;
    }
    const text = body.trim();
    setTyping(false);
    if (file) sendFile(file, text);
    else if (text) send(text);
  };
  const replyOpen = textReply && !blockedReason;

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
          if (message.direction === 'note') {
            return (
              <li key={message.id} className="flex flex-col items-stretch gap-1 px-2 sm:px-8">
                <div
                  className={cn(
                    'flex flex-col gap-1 rounded-xl border border-warning-border bg-warning/10 px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap',
                    message.id.startsWith('pending-') && 'opacity-70',
                  )}
                  data-sensitive
                >
                  <span className="flex items-center gap-1 text-xs font-medium text-warning-text">
                    <Lock aria-hidden className="size-3" /> Private note · not sent to the customer
                  </span>
                  <span>{message.body}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {message.sentByName ?? 'A colleague'} · {message.sentAtLabel}
                </p>
              </li>
            );
          }
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
                {message.unverified && (
                  <span
                    className="rounded border border-warning-border bg-warning/10 px-1 text-warning-text"
                    title="This email did not pass the sender checks (DKIM or DMARC), so the address it came from may be forged. It is not linked to a contact automatically."
                  >
                    Sender not verified
                  </span>
                )}
                {message.automated && <span>· automatic message</span>}
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

      {canReply && <PresenceNote others={others} members={presence?.members ?? []} />}
      {canReply && (
        <div className="flex flex-col gap-2 rounded-xl border bg-card p-3">
          <div role="tablist" aria-label="What to write" className="flex gap-1">
            <Button
              type="button"
              role="tab"
              aria-selected={mode === 'reply'}
              variant={mode === 'reply' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                setMode('reply');
                setPicker(null);
              }}
            >
              <Send aria-hidden /> Reply
            </Button>
            <Button
              type="button"
              role="tab"
              aria-selected={mode === 'note'}
              variant={mode === 'note' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                setMode('note');
                setPicker(null);
              }}
            >
              <Lock aria-hidden /> Private note
            </Button>
          </div>
          {mode === 'reply' && !replyOpen ? (
            <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
              {blockedReason ?? 'Send an approved template below.'} You can still leave a private
              note for colleagues.
            </p>
          ) : (
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              {mode === 'reply' && file && (
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
              <div className="relative">
                <Textarea
                  aria-label={
                    mode === 'note' ? 'Private note for colleagues' : 'Reply to the customer'
                  }
                  placeholder={
                    mode === 'note'
                      ? 'Only your colleagues see this note…'
                      : file
                        ? attach?.captions
                          ? 'Add a caption (optional)…'
                          : 'Add words to send after the file (optional)…'
                        : canned.length > 0
                          ? 'Write your reply, or type / for a saved reply…'
                          : 'Write your reply…'
                  }
                  rows={2}
                  required={mode === 'note' || !file}
                  maxLength={mode === 'note' ? 4000 : maxChars}
                  value={mode === 'note' ? note : body}
                  className={cn(mode === 'note' && 'border-warning-border bg-warning/5')}
                  onChange={(event) => onComposerChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && picker !== null) {
                      event.preventDefault();
                      setPicker(null);
                      return;
                    }
                    if (event.key === 'Enter' && picker !== null && matches[0]) {
                      event.preventDefault();
                      insertCanned(matches[0].body);
                      return;
                    }
                    // Enter sends, Shift+Enter starts a new line, as in the platforms' own apps.
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      submit();
                    }
                  }}
                />
                {picker !== null && (
                  <ul
                    aria-label="Saved replies"
                    className="absolute bottom-full left-0 z-10 mb-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover p-1 text-sm shadow-md"
                  >
                    {matches.length === 0 && (
                      <li className="px-2 py-1.5 text-muted-foreground">No saved reply matches.</li>
                    )}
                    {matches.map((reply) => (
                      <li key={reply.id}>
                        <button
                          type="button"
                          className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                          onClick={() => insertCanned(reply.body)}
                        >
                          <span className="flex items-center gap-1.5 font-medium">
                            {reply.title}
                            {reply.shortcut && (
                              <span className="text-xs font-normal text-muted-foreground">
                                /{reply.shortcut}
                              </span>
                            )}
                          </span>
                          <span className="line-clamp-1 text-xs text-muted-foreground">
                            {reply.body}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground tabular-nums">
                  {mode === 'note'
                    ? 'Saved in the thread for colleagues; never sent.'
                    : humanAgent
                      ? 'Sent as a reply from a person: more than 24 hours have passed since their last message.'
                      : `${body.length} / ${maxChars}`}
                </p>
                <div className="flex items-center gap-1.5">
                  {articles && mode === 'reply' && (
                    <ArticlePicker
                      target={{ conversationId }}
                      onInsert={(text) =>
                        setBody((current) =>
                          current.trim() ? `${current.trimEnd()}\n${text}` : text,
                        )
                      }
                    />
                  )}
                  {canned.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Insert a saved reply"
                      aria-expanded={picker !== null}
                      onClick={() => setPicker(picker === null ? '' : null)}
                    >
                      <MessageSquareText aria-hidden />
                    </Button>
                  )}
                  {mode === 'reply' && attach && (
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
                  {mode === 'note' ? (
                    <Button type="submit" size="sm" variant="secondary" disabled={!note.trim()}>
                      <BookmarkPlus aria-hidden /> Save note
                    </Button>
                  ) : (
                    <Button type="submit" size="sm" disabled={!file && body.trim().length === 0}>
                      <Send aria-hidden /> Send
                    </Button>
                  )}
                </div>
              </div>
            </form>
          )}
        </div>
      )}
      {canReply && extra && (
        // On a wide screen the thread has a fixed height: a tall template form scrolls in place
        // instead of spilling over the page.
        <div className="shrink-0 lg:max-h-[45dvh] lg:overflow-y-auto">{extra}</div>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
