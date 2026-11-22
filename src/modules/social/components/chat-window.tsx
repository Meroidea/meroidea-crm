'use client';

import { Loader2, Send, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/*
 * The visitor's chat (ADR-072), inside the widget's frame on the business's site, or opened as a
 * page of its own. It talks only to /api/chat/{key}; its token is kept in this frame's storage,
 * which browsers keep per site, and is sent in a header, never in an address. The page around it
 * (the loader, /widget/v1.js) opens and closes it and may pass who the visitor is.
 */

type Visitor = { name: string | null; email: string | null; verified: boolean };
type Message = { id: string; from: 'visitor' | 'business'; body: string | null; at: string };
type Pending = { clientId: string; body: string; failed: boolean };
type Identity = { email: string; name?: string; signature: string };
type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

const POLL_OPEN_MS = 3000;
const POLL_IDLE_MS = 20_000;
/** How long the frame waits for the page to say who the visitor is before starting anyway. */
const IDENTITY_WAIT_MS = 600;

function storageKey(widgetKey: string) {
  return `meroidea-chat:${widgetKey}`;
}
function readToken(widgetKey: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(widgetKey));
  } catch {
    return null;
  }
}
function writeToken(widgetKey: string, token: string | null) {
  try {
    if (token) window.localStorage.setItem(storageKey(widgetKey), token);
    else window.localStorage.removeItem(storageKey(widgetKey));
  } catch {
    // Storage blocked: the chat lasts as long as this page.
  }
}

async function call<T>(url: string, init: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, { ...init, cache: 'no-store' });
    return (await response.json()) as ApiResult<T>;
  } catch {
    return { ok: false, error: { code: 'NETWORK', message: 'You seem to be offline. Try again.' } };
  }
}

/** Tells the page around the frame something, when there is one. */
function tellParent(message: Record<string, unknown>) {
  if (window.parent !== window)
    window.parent.postMessage({ source: 'meroidea-chat', ...message }, '*');
}

export function ChatWindow({
  widgetKey,
  name,
  greeting,
  requireEmail,
  embedded,
}: {
  widgetKey: string;
  name: string;
  greeting: string | null;
  requireEmail: boolean;
  /** Inside the loader's frame on the business's site, rather than a page of its own. */
  embedded: boolean;
}) {
  const api = `/api/chat/${widgetKey}`;
  const [token, setToken] = useState<string | null>(null);
  const [visitor, setVisitor] = useState<Visitor | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [open, setOpen] = useState(!embedded);
  const cursor = useRef<string | null>(null);
  const identity = useRef<Identity | null>(null);
  const seen = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const startSession = useCallback(
    async (extra: { name?: string; email?: string } = {}) => {
      const result = await call<{ token: string; visitor: Visitor }>(`${api}/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: readToken(widgetKey) ?? undefined,
          identity: identity.current ?? undefined,
          ...extra,
        }),
      });
      if (!result.ok) {
        setError(result.error.message);
        return false;
      }
      if (result.data.token !== readToken(widgetKey)) {
        // A new chat: forget the old one's messages.
        cursor.current = null;
        setMessages([]);
      }
      writeToken(widgetKey, result.data.token);
      setToken(result.data.token);
      setVisitor(result.data.visitor);
      setError(null);
      return true;
    },
    [api, widgetKey],
  );

  // Start once the page has said who the visitor is, or after a moment without.
  useEffect(() => {
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      void startSession().finally(() => setStarting(false));
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const data = event.data as { source?: string; type?: string; identity?: Identity } | null;
      if (data?.source !== 'meroidea-chat-loader') return;
      if (data.type === 'open') setOpen(true);
      if (data.type === 'close') setOpen(false);
      if (data.type === 'identify' && data.identity) {
        identity.current = data.identity;
        if (started) void startSession();
        else start();
      }
    };
    window.addEventListener('message', onMessage);
    tellParent({ type: 'ready' });
    const timer = window.setTimeout(start, embedded ? IDENTITY_WAIT_MS : 0);
    return () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
    };
  }, [embedded, startSession]);

  const poll = useCallback(async () => {
    if (!token) return;
    const query = cursor.current ? `?after=${encodeURIComponent(cursor.current)}` : '';
    const result = await call<{ messages: Message[]; cursor: string | null }>(
      `${api}/messages${query}`,
      { headers: { 'x-chat-token': token } },
    );
    if (!result.ok) {
      if (result.error.code === 'NOT_FOUND') {
        writeToken(widgetKey, null);
        setToken(null);
      }
      return;
    }
    cursor.current = result.data.cursor;
    if (result.data.messages.length === 0) return;
    setMessages((current) => {
      const known = new Set(current.map((message) => message.id));
      const fresh = result.data.messages.filter((message) => !known.has(message.id));
      return fresh.length === 0 ? current : [...current, ...fresh];
    });
  }, [api, token, widgetKey]);

  useEffect(() => {
    if (!token) return;
    let timer: number | undefined;
    let stopped = false;
    const loop = async () => {
      await poll();
      if (stopped) return;
      const active = open && document.visibilityState === 'visible';
      timer = window.setTimeout(loop, active ? POLL_OPEN_MS : POLL_IDLE_MS);
    };
    void loop();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        window.clearTimeout(timer);
        void loop();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [open, poll, token]);

  const replies = messages.filter((message) => message.from === 'business').length;
  // The page shows a count of replies the visitor has not seen while the chat is closed.
  useEffect(() => {
    if (open) seen.current = replies;
    tellParent({ type: 'unread', count: Math.max(0, replies - seen.current) });
  }, [open, replies]);
  useEffect(() => {
    if (messages.length > 0) tellParent({ type: 'active' });
  }, [messages.length]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, pending.length, open]);

  const send = useCallback(
    async (body: string, clientId: string = crypto.randomUUID()) => {
      if (!token) return;
      setPending((current) => [
        ...current.filter((item) => item.clientId !== clientId),
        { clientId, body, failed: false },
      ]);
      const result = await call<{ message: Message }>(`${api}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, clientId, body }),
      });
      if (!result.ok) {
        setError(result.error.message);
        setPending((current) =>
          current.map((item) => (item.clientId === clientId ? { ...item, failed: true } : item)),
        );
        return;
      }
      setError(null);
      setPending((current) => current.filter((item) => item.clientId !== clientId));
      setMessages((current) =>
        current.some((message) => message.id === result.data.message.id)
          ? current
          : [...current, result.data.message],
      );
    },
    [api, token],
  );

  const needsEmail = requireEmail && visitor !== null && !visitor.email;
  const ordered = useMemo(() => [...messages].sort((a, b) => a.at.localeCompare(b.at)), [messages]);

  return (
    <div className="flex h-svh flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b bg-primary px-4 py-3 text-primary-foreground">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{name}</h1>
          <p className="text-xs opacity-90">We usually reply in a few minutes.</p>
        </div>
        {embedded && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
            aria-label="Close chat"
            onClick={() => {
              setOpen(false);
              tellParent({ type: 'close' });
            }}
          >
            <X aria-hidden className="size-5" />
          </Button>
        )}
      </header>

      <div
        ref={listRef}
        className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4"
        aria-live="polite"
        aria-label="Messages"
      >
        {greeting && <Bubble from="business" body={greeting} />}
        {ordered.map((message) => (
          <Bubble key={message.id} from={message.from} body={message.body ?? '(Attachment)'} />
        ))}
        {pending.map((item) => (
          <Bubble
            key={item.clientId}
            from="visitor"
            body={item.body}
            state={item.failed ? 'failed' : 'sending'}
            onRetry={() => void send(item.body, item.clientId)}
          />
        ))}
      </div>

      {error && (
        <p
          role="alert"
          className="mx-4 mb-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
        >
          {error}
        </p>
      )}

      {starting ? (
        <div className="flex items-center justify-center gap-2 border-t p-4 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Connecting…
        </div>
      ) : !token ? (
        <div className="border-t p-4">
          <Button type="button" className="w-full" onClick={() => void startSession()}>
            Start a new chat
          </Button>
        </div>
      ) : needsEmail ? (
        <PreChatForm
          defaultName={visitor?.name ?? ''}
          onSubmit={(details) => startSession(details)}
        />
      ) : (
        <form
          className="flex items-end gap-2 border-t p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const body = draft.trim();
            if (!body) return;
            setDraft('');
            void send(body);
          }}
        >
          <Label htmlFor="chat-message" className="sr-only">
            Your message
          </Label>
          <Textarea
            id="chat-message"
            value={draft}
            maxLength={2000}
            rows={1}
            placeholder="Write a message…"
            className="max-h-32 min-h-10 resize-none"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <Button type="submit" size="icon" aria-label="Send" disabled={!draft.trim()}>
            <Send aria-hidden className="size-4" />
          </Button>
        </form>
      )}
    </div>
  );
}

function Bubble({
  from,
  body,
  state,
  onRetry,
}: {
  from: 'visitor' | 'business';
  body: string;
  state?: 'sending' | 'failed';
  onRetry?: () => void;
}) {
  const mine = from === 'visitor';
  return (
    <div className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
      <p
        className={cn(
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap',
          mine ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-muted',
          state === 'sending' && 'opacity-70',
        )}
      >
        {body}
      </p>
      {state === 'failed' && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-0.5 text-xs text-destructive-text underline-offset-2 hover:underline"
        >
          Not sent. Try again
        </button>
      )}
    </div>
  );
}

function PreChatForm({
  defaultName,
  onSubmit,
}: {
  defaultName: string;
  onSubmit: (details: { name?: string; email: string }) => Promise<boolean>;
}) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-3 border-t p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        await onSubmit({ name: name.trim() || undefined, email: email.trim() });
        setBusy(false);
      }}
    >
      <p className="text-sm text-muted-foreground">
        Tell us how to reach you, in case you leave before we reply.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="chat-name">Name</Label>
        <Input
          id="chat-name"
          value={name}
          maxLength={120}
          autoComplete="name"
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="chat-email">Email</Label>
        <Input
          id="chat-email"
          type="email"
          required
          value={email}
          maxLength={200}
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <Button type="submit" disabled={busy}>
        {busy && <Loader2 aria-hidden className="size-4 animate-spin" />} Start chatting
      </Button>
    </form>
  );
}
