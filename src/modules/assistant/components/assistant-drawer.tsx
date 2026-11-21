'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { ArrowUp, Loader2, RotateCcw, Search, Sparkles, Square } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';

import type { PendingActionView } from '../pending-schemas';
import { ActionCard } from './action-card';
import { SafeMarkdown } from './safe-markdown';

export type AssistantAbilities = {
  reports: boolean;
  invoices: boolean;
  rosters: boolean;
  staffEmail: boolean;
  tasks: boolean;
};

const LOOKUPS: Record<string, string> = {
  get_pipeline_stats: 'Checked the pipeline',
  get_overdue_follow_ups: 'Checked overdue follow-ups',
  get_sales_report: 'Read the sales report',
  search_records: 'Searched records',
};

function suggestions(abilities: AssistantAbilities): string[] {
  return [
    abilities.reports && 'Summarise this month’s sales: won vs forecast, and what has stalled',
    abilities.tasks && 'What follow-ups am I behind on?',
    abilities.invoices && 'Draft an invoice for a customer',
    abilities.rosters && 'Build next week’s roster',
    abilities.staffEmail && 'Draft an email to all staff',
  ].filter((text): text is string => Boolean(text));
}

type ToolPart = {
  type: string;
  toolCallId: string;
  state: string;
  output?: { proposal?: PendingActionView };
};

/**
 * Meroidea AI (ADR-063, ADR-064): a chat drawer on every workspace page, opened from the header or
 * with ⌘K / Ctrl+K. Answers stream in; anything that would change the business arrives as a
 * confirmation card and waits for the person to approve it.
 */
export function AssistantDrawer({
  currency,
  abilities,
}: {
  currency: string;
  abilities: AssistantAbilities;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status, stop, error, regenerate, setMessages, clearError } =
    useChat({ transport: new DefaultChatTransport({ api: '/api/ai/chat' }) });
  const busy = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, status]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    void sendMessage({ text: trimmed });
    setInput('');
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send(input);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(input);
    }
  };

  const revise = (text: string) => {
    setInput(text);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="Open Meroidea AI (Ctrl+K)"
        title="Meroidea AI (⌘K / Ctrl+K)"
        className="gap-1.5"
      >
        <Sparkles aria-hidden className="text-primary" />
        <span className="hidden sm:inline">Ask AI</span>
        <kbd className="hidden rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground md:inline">
          ⌘K
        </kbd>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
        >
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" aria-hidden />
              Meroidea AI
            </SheetTitle>
            <SheetDescription className="text-xs">
              Answers use only what you can see. Changes wait for your approval.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Try asking:</p>
                {suggestions(abilities).map((text) => (
                  <button
                    key={text}
                    type="button"
                    onClick={() => send(text)}
                    className="block w-full rounded-lg border bg-card px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}

            {messages.map((message) => (
              <Message key={message.id} message={message} currency={currency} onRevise={revise} />
            ))}

            {status === 'submitted' && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Thinking…
              </p>
            )}
            {error && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive-text"
              >
                {friendlyError(error)}
                <Button
                  size="xs"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => {
                    clearError();
                    void regenerate();
                  }}
                >
                  <RotateCcw aria-hidden /> Retry
                </Button>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={onSubmit} className="border-t p-3">
            <div className="flex items-end gap-2">
              <Textarea
                ref={inputRef}
                rows={2}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask about sales, or say what to prepare…"
                aria-label="Message Meroidea AI"
                className="max-h-40 min-h-10 resize-none text-sm"
                maxLength={4_000}
              />
              {busy ? (
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => void stop()}
                  aria-label="Stop"
                >
                  <Square aria-hidden />
                </Button>
              ) : (
                <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Send">
                  <ArrowUp aria-hidden />
                </Button>
              )}
            </div>
            {messages.length > 0 && !busy && (
              <button
                type="button"
                onClick={() => setMessages([])}
                className="mt-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                New conversation
              </button>
            )}
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

function friendlyError(error: Error): string {
  // The server answers with a JSON error; show its message when it has one.
  try {
    const parsed = JSON.parse(error.message) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return 'The assistant could not answer just now.';
}

function Message({
  message,
  currency,
  onRevise,
}: {
  message: UIMessage;
  currency: string;
  onRevise: (text: string) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="ml-8 rounded-xl bg-primary/10 px-3 py-2 text-sm whitespace-pre-wrap">
        {message.parts.map((part, index) =>
          part.type === 'text' ? <span key={index}>{part.text}</span> : null,
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm">
      {message.parts.map((part, index) => {
        if (part.type === 'text') return <SafeMarkdown key={index} text={part.text} />;
        if (!part.type.startsWith('tool-')) return null;
        const tool = part as unknown as ToolPart;
        const name = tool.type.slice('tool-'.length);
        if (name.startsWith('propose_')) {
          if (tool.state === 'output-available' && tool.output?.proposal) {
            return (
              <ActionCard
                key={tool.toolCallId}
                initial={tool.output.proposal}
                currency={currency}
                onRevise={onRevise}
              />
            );
          }
          if (tool.state === 'input-streaming' || tool.state === 'input-available') {
            return (
              <p
                key={tool.toolCallId}
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Preparing a proposal…
              </p>
            );
          }
          return null;
        }
        const done = tool.state === 'output-available' || tool.state === 'output-error';
        return (
          <p
            key={tool.toolCallId}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            {done ? (
              <Search className="size-3" aria-hidden />
            ) : (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            )}
            {LOOKUPS[name] ?? 'Looked something up'}
          </p>
        );
      })}
    </div>
  );
}
