'use client';

import {
  CalendarClock,
  Check,
  ListTodo,
  Loader2,
  MessageSquareText,
  NotebookPen,
  Reply,
  Send,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition, type ReactNode, type RefObject } from 'react';

import { MeroOrb } from '@/components/motion/mero-orb';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { noteAction } from '@/modules/social/actions';
import type { EmailEditorHandle } from '@/modules/social/components/email-editor';
import { emailDocText, type EmailDoc } from '@/modules/social/email-doc';
import { createTaskAction } from '@/modules/tasks/actions';

import {
  askEmailInboxAction,
  askEmailThreadAction,
  draftReplyWithMeroAIAction,
  rewriteEmailWithMeroAIAction,
  summariseEmailThreadAction,
  writeEmailWithMeroAIAction,
} from '../actions';
import type { EmailSummary, InboxAnswer } from '../meroai-email';
import { splitAtSignature } from '../email-signature';
import { EMAIL_REWRITES, EMAIL_TONES, REPLY_INTENTS } from '../schemas';

/*
 * MeroAI in Email (ADR-092). Everything here puts words in front of the person: in the editor
 * (with Undo), or on the screen. Sending, saving a note and creating a task stay their own clicks.
 */

/** Asks the reply box's MeroAI to draft a reply with these instructions (from a summary). */
export const MEROAI_REPLY_EVENT = 'meroidea:meroai-reply';
type MeroAIReplyRequest = { instruction: string };

const TONE_LABELS: Record<(typeof EMAIL_TONES)[number], string> = {
  friendly: 'Friendly',
  professional: 'Professional',
  brief: 'Brief',
  formal: 'Formal',
};

const REWRITE_LABELS: Record<(typeof EMAIL_REWRITES)[number], string> = {
  improve: 'Improve writing',
  shorter: 'Make shorter',
  friendlier: 'Make friendlier',
  formal: 'Make more formal',
  fix: 'Fix spelling and grammar',
  translate: 'Translate…',
};

const INTENT_LABELS: Record<(typeof REPLY_INTENTS)[number], string> = {
  reply: 'Answer their email',
  accept: 'Say yes',
  decline: 'Decline politely',
  more_info: 'Ask for details',
  thanks: 'Thank them',
};

const LANGUAGES = [
  'English',
  'Spanish',
  'Chinese',
  'Hindi',
  'Nepali',
  'Arabic',
  'Vietnamese',
  'French',
];

const BLANK: EmailDoc[number] = { type: 'paragraph', content: [] };

function messageOf(result: {
  ok: false;
  error: { message: string; fieldErrors?: Record<string, string[]> };
}) {
  return Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message;
}

function MeroAIHeading({ thinking, children }: { thinking: boolean; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-sm font-medium">
      <MeroOrb size={20} state={thinking ? 'thinking' : 'idle'} />
      {children}
    </span>
  );
}

/* --------------------------------------------------------------------- writing (editor) */

/**
 * MeroAI above an email editor: write the email (Compose) or a reply (reply box) from a few
 * words, and rewrite what is there. The result goes into the editor, never out; Undo puts back
 * what was there before.
 */
export function MeroAIWriter({
  mode,
  conversationId,
  editor,
  signature,
  disabled = false,
  getTo,
  getSubject,
  onSubject,
  onChange,
}: {
  mode: 'compose' | 'reply';
  /** The thread, for a reply. */
  conversationId?: string;
  editor: RefObject<EmailEditorHandle | null>;
  /** The person's signature, kept below what MeroAI writes. */
  signature: EmailDoc | null;
  disabled?: boolean;
  getTo?: () => string[];
  getSubject?: () => string;
  /** Compose: MeroAI's subject line, used when the subject is still empty. */
  onSubject?: (subject: string) => void;
  /** Called after the editor's words change, so drafts are saved. */
  onChange?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [tone, setTone] = useState<(typeof EMAIL_TONES)[number]>('friendly');
  const [intent, setIntent] = useState<(typeof REPLY_INTENTS)[number]>('reply');
  const [translating, setTranslating] = useState(false);
  const [language, setLanguage] = useState('');
  const [undo, setUndo] = useState<{ doc: EmailDoc; subject: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const panel = useRef<HTMLDivElement>(null);
  const busy = pending || disabled;

  /** Puts MeroAI's words in the editor above the signature, remembering what was there. */
  const place = (written: EmailDoc, subject: string | null, rest: EmailDoc, before: EmailDoc) => {
    const previousSubject = getSubject?.() ?? null;
    editor.current?.load(rest.length > 0 ? [...written, BLANK, ...rest] : written);
    let subjectChanged: string | null = null;
    if (subject && onSubject && !previousSubject?.trim()) {
      onSubject(subject);
      subjectChanged = previousSubject ?? '';
    }
    setUndo({ doc: before, subject: subjectChanged });
    onChange?.();
  };

  const run = (
    request: (
      body: EmailDoc,
      signed: boolean,
    ) => Promise<
      | { ok: true; data: { doc: EmailDoc; subject?: string | null } }
      | { ok: false; error: { message: string; fieldErrors?: Record<string, string[]> } }
    >,
    keepsFormatting = true,
  ) => {
    const before = editor.current?.read() ?? [];
    const { body, rest, signed } = splitAtSignature(before, signature);
    setError(null);
    setNote(null);
    startTransition(async () => {
      const result = await request(body, signed);
      if (!result.ok) {
        setError(messageOf(result));
        return;
      }
      place(result.data.doc, result.data.subject ?? null, rest, before);
      const lost = body.some((block) => block.type === 'image' || block.type === 'table');
      setNote(
        !keepsFormatting && lost
          ? 'Pictures and tables in your text were not kept. Undo brings them back.'
          : 'MeroAI wrote this. Read it through before you send.',
      );
    });
  };

  const write = () =>
    run((_, signed) =>
      mode === 'compose'
        ? writeEmailWithMeroAIAction({ instruction, tone, to: getTo?.() ?? [], signed })
        : draftReplyWithMeroAIAction({
            conversationId: conversationId!,
            intent,
            tone,
            signed,
            ...(instruction.trim() ? { instruction } : {}),
          }),
    );

  const rewrite = (kind: (typeof EMAIL_REWRITES)[number]) => {
    const text = emailDocText(
      splitAtSignature(editor.current?.read() ?? [], signature).body,
    ).trim();
    if (!text) {
      setError('Write something first, then MeroAI can rewrite it.');
      return;
    }
    if (kind === 'translate' && !language.trim()) {
      setTranslating(true);
      return;
    }
    run(
      () =>
        rewriteEmailWithMeroAIAction({
          text,
          kind,
          ...(kind === 'translate' ? { language: language.trim() } : {}),
        }),
      false,
    );
    setTranslating(false);
  };

  // "Draft a reply" from a thread summary opens this box with its instructions and drafts.
  useEffect(() => {
    if (mode !== 'reply') return;
    const listen = (event: Event) => {
      const { instruction: given } = (event as CustomEvent<MeroAIReplyRequest>).detail;
      setOpen(true);
      setIntent('reply');
      setInstruction(given);
      panel.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const before = editor.current?.read() ?? [];
      const { rest, signed } = splitAtSignature(before, signature);
      setError(null);
      startTransition(async () => {
        const result = await draftReplyWithMeroAIAction({
          conversationId: conversationId!,
          intent: 'reply',
          tone,
          signed,
          instruction: given,
        });
        if (!result.ok) setError(messageOf(result));
        else {
          place(result.data.doc, null, rest, before);
          setNote('MeroAI wrote this. Read it through before you send.');
        }
      });
    };
    window.addEventListener(MEROAI_REPLY_EVENT, listen);
    return () => window.removeEventListener(MEROAI_REPLY_EVENT, listen);
    // Registered once per box; the latest tone is read when an event arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, conversationId, signature]);

  return (
    <div ref={panel} className="meroai-surface border-b">
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5">
        <button
          type="button"
          className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm font-medium hover:bg-muted/60"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          disabled={disabled}
        >
          <MeroOrb size={20} state={pending ? 'thinking' : 'idle'} />
          <span className="meroai-text">
            {mode === 'compose' ? 'Write with MeroAI' : 'Reply with MeroAI'}
          </span>
        </button>
        <select
          aria-label="Rewrite with MeroAI"
          className="h-7 max-w-44 rounded-md border bg-background px-2 text-xs"
          value=""
          disabled={busy}
          onChange={(event) => {
            const kind = event.target.value as (typeof EMAIL_REWRITES)[number];
            if (kind) rewrite(kind);
          }}
        >
          <option value="" disabled>
            Rewrite…
          </option>
          {EMAIL_REWRITES.map((kind) => (
            <option key={kind} value={kind}>
              {REWRITE_LABELS[kind]}
            </option>
          ))}
        </select>
        {pending && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
            <Loader2 aria-hidden className="size-3 animate-spin" /> MeroAI is writing…
          </span>
        )}
        {undo && !pending && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => {
              editor.current?.load(undo.doc);
              if (undo.subject !== null) onSubject?.(undo.subject);
              setUndo(null);
              setNote(null);
              onChange?.();
            }}
          >
            <Undo2 aria-hidden /> Undo
          </Button>
        )}
      </div>

      {translating && (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
          <label htmlFor={`meroai-language-${mode}`} className="text-xs text-muted-foreground">
            Translate into
          </label>
          <Input
            id={`meroai-language-${mode}`}
            list={`meroai-languages-${mode}`}
            className="h-7 w-40 text-xs"
            maxLength={40}
            value={language}
            autoFocus
            onChange={(event) => setLanguage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (language.trim()) rewrite('translate');
              }
            }}
          />
          <datalist id={`meroai-languages-${mode}`}>
            {LANGUAGES.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <Button
            type="button"
            size="sm"
            className="h-7 text-xs"
            disabled={busy || !language.trim()}
            onClick={() => rewrite('translate')}
          >
            Translate
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setTranslating(false)}
          >
            Cancel
          </Button>
        </div>
      )}

      {open && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {mode === 'reply' && (
            <div
              className="flex flex-wrap gap-1.5"
              role="radiogroup"
              aria-label="What should the reply do?"
            >
              {REPLY_INTENTS.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={intent === key}
                  onClick={() => setIntent(key)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs',
                    intent === key ? 'border-primary bg-accent font-medium' : 'hover:bg-muted',
                  )}
                >
                  {INTENT_LABELS[key]}
                </button>
              ))}
            </div>
          )}
          <label htmlFor={`meroai-instruction-${mode}`} className="sr-only">
            {mode === 'compose' ? 'What should the email say?' : 'Anything the reply should say?'}
          </label>
          <Textarea
            id={`meroai-instruction-${mode}`}
            rows={2}
            maxLength={mode === 'compose' ? 2000 : 1000}
            value={instruction}
            disabled={busy}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                write();
              }
            }}
            placeholder={
              mode === 'compose'
                ? 'What should the email say? For example: thank Kim for visiting today, confirm the quote is valid for 30 days, and offer a call next week'
                : 'Optional: anything the reply should say, e.g. we can deliver on Friday after 2 pm'
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Tone"
              className="h-8 rounded-md border bg-background px-2 text-sm"
              value={tone}
              disabled={busy}
              onChange={(event) => setTone(event.target.value as (typeof EMAIL_TONES)[number])}
            >
              {EMAIL_TONES.map((key) => (
                <option key={key} value={key}>
                  {TONE_LABELS[key]}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              className="meroai-button"
              disabled={busy || (mode === 'compose' && instruction.trim().length < 3)}
              onClick={write}
            >
              <Sparkles aria-hidden />
              {mode === 'compose' ? 'Write it' : 'Draft reply'}
            </Button>
            <span className="text-xs text-muted-foreground">
              Goes into the editor for you to check. Nothing is sent.
            </span>
          </div>
        </div>
      )}

      {(error || note) && (
        <p
          role={error ? 'alert' : 'status'}
          className={cn(
            'px-3 pb-2 text-xs',
            error ? 'text-destructive-text' : 'text-muted-foreground',
          )}
        >
          {error ?? note}
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- understanding a thread */

const SENTIMENT: Record<
  EmailSummary['sentiment'],
  { label: string; variant: 'secondary' | 'outline' | 'destructive' }
> = {
  positive: { label: 'Positive', variant: 'secondary' },
  neutral: { label: 'Neutral', variant: 'outline' },
  negative: { label: 'Unhappy', variant: 'destructive' },
  urgent: { label: 'Urgent', variant: 'destructive' },
};

function summaryAsNote(summary: EmailSummary): string {
  const lines = [`MeroAI summary: ${summary.summary}`];
  if (summary.customerAsks.length > 0) {
    lines.push('', 'Customer asks:', ...summary.customerAsks.map((item) => `- ${item}`));
  }
  if (summary.dates.length > 0) {
    lines.push('', 'Dates:', ...summary.dates.map((item) => `- ${item.what}: ${item.when}`));
  }
  if (summary.nextStep) lines.push('', `Next step: ${summary.nextStep}`);
  return lines.join('\n').slice(0, 4000);
}

function FollowUp({
  item,
  contactId,
}: {
  item: EmailSummary['followUps'][number];
  contactId: string | null;
}) {
  const [state, setState] = useState<'idle' | 'done' | string>('idle');
  const [pending, startTransition] = useTransition();
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-0 flex-1">
        {item.title}
        {item.dueDate && <span className="text-muted-foreground"> · due {item.dueDate}</span>}
      </span>
      {state === 'done' ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Check aria-hidden className="size-3" /> Task created
        </span>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await createTaskAction({
                title: item.title,
                type: 'follow_up',
                priority: 'normal',
                dueDate: item.dueDate ?? '',
                ...(contactId ? { contactId } : {}),
              });
              setState(result.ok ? 'done' : messageOf(result));
            })
          }
        >
          <ListTodo aria-hidden /> Create task
        </Button>
      )}
      {state !== 'idle' && state !== 'done' && (
        <span role="alert" className="w-full text-xs text-destructive-text">
          {state}
        </span>
      )}
    </li>
  );
}

const THREAD_QUESTIONS = [
  'What does the customer want?',
  'Did we promise anything?',
  'Is there a deadline or date?',
  'What is still unanswered?',
];

/**
 * MeroAI on an email thread: a summary (what it is about, what the customer asks, dates, the
 * next step) and questions answered only from the thread's emails. A summary can become a
 * private note, its follow-ups tasks, and its next step a drafted reply: each by a click.
 */
export function MeroAIThreadPanel({
  conversationId,
  contactId,
  canNote,
  canTask,
  canReply,
}: {
  conversationId: string;
  contactId: string | null;
  canNote: boolean;
  canTask: boolean;
  /** The reply box (with MeroAI) is on the page. */
  canReply: boolean;
}) {
  const [tab, setTab] = useState<'summary' | 'ask'>('summary');
  const [summary, setSummary] = useState<EmailSummary | null>(null);
  const [noted, setNoted] = useState(false);
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<{ question: string; answer: string; found: boolean }[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const summarise = () =>
    startTransition(async () => {
      setError(null);
      setNoted(false);
      const result = await summariseEmailThreadAction({ conversationId });
      if (result.ok) setSummary(result.data);
      else setError(messageOf(result));
    });

  const ask = (text: string) => {
    const asked = text.trim();
    if (asked.length < 2) return;
    startTransition(async () => {
      setError(null);
      const result = await askEmailThreadAction({
        conversationId,
        question: asked,
        history: answers.slice(-4).map(({ question: q, answer }) => ({
          question: q,
          answer: answer.slice(0, 2000),
        })),
      });
      if (!result.ok) {
        setError(messageOf(result));
        return;
      }
      setAnswers((list) => [...list, { question: asked, ...result.data }]);
      setQuestion('');
    });
  };

  const saveNote = () =>
    startTransition(async () => {
      if (!summary) return;
      const result = await noteAction({ conversationId, body: summaryAsNote(summary) });
      if (result.ok) setNoted(true);
      else setError(messageOf(result));
    });

  return (
    <details className="group meroai-edge meroai-surface shrink-0 rounded-xl">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2">
        <MeroAIHeading thinking={pending}>
          Ask <span className="meroai-text">MeroAI</span> about this email
        </MeroAIHeading>
        <span className="ml-auto text-xs text-muted-foreground">Summarise, or ask a question</span>
      </summary>
      <div className="flex max-h-[45dvh] flex-col gap-3 overflow-y-auto border-t p-3">
        <div role="tablist" aria-label="MeroAI" className="flex gap-1.5">
          {(
            [
              ['summary', 'Summary', Sparkles],
              ['ask', 'Ask a question', MessageSquareText],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm',
                tab === key ? 'border-primary bg-accent font-medium' : 'hover:bg-muted',
              )}
            >
              <Icon aria-hidden className="size-4" /> {label}
            </button>
          ))}
        </div>

        {tab === 'summary' &&
          (summary === null ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                className="meroai-button"
                onClick={summarise}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 aria-hidden className="animate-spin" />
                ) : (
                  <Sparkles aria-hidden />
                )}
                {pending ? 'Reading the thread…' : 'Summarise this thread'}
              </Button>
              <span className="text-xs text-muted-foreground">
                Private notes are never sent to MeroAI.
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-3 text-sm" aria-live="polite">
              <div className="flex flex-wrap items-start gap-2">
                <p className="min-w-0 flex-1" data-sensitive>
                  {summary.summary}
                </p>
                <Badge variant={SENTIMENT[summary.sentiment].variant}>
                  {SENTIMENT[summary.sentiment].label}
                </Badge>
              </div>
              {summary.customerAsks.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground">The customer asks</h3>
                  <ul className="mt-1 list-disc pl-5" data-sensitive>
                    {summary.customerAsks.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              )}
              {summary.keyPoints.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground">Key points</h3>
                  <ul className="mt-1 list-disc pl-5" data-sensitive>
                    {summary.keyPoints.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              )}
              {summary.dates.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground">Dates</h3>
                  <ul className="mt-1 flex flex-col gap-0.5" data-sensitive>
                    {summary.dates.map((item) => (
                      <li key={`${item.what}-${item.when}`} className="flex items-center gap-1.5">
                        <CalendarClock aria-hidden className="size-3.5 text-muted-foreground" />
                        <span>
                          {item.what}: <span className="font-medium">{item.when}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {summary.nextStep && (
                <section className="rounded-lg border bg-card p-2">
                  <h3 className="text-xs font-semibold text-muted-foreground">Next step</h3>
                  <p className="mt-0.5" data-sensitive>
                    {summary.nextStep}
                  </p>
                  {canReply && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2 h-7 text-xs"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent<MeroAIReplyRequest>(MEROAI_REPLY_EVENT, {
                            detail: { instruction: summary.nextStep! },
                          }),
                        )
                      }
                    >
                      <Reply aria-hidden /> Draft a reply for this
                    </Button>
                  )}
                </section>
              )}
              {canTask && summary.followUps.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground">Follow-ups</h3>
                  <ul className="mt-1 flex flex-col gap-1.5" data-sensitive>
                    {summary.followUps.map((item) => (
                      <FollowUp key={item.title} item={item} contactId={contactId} />
                    ))}
                  </ul>
                </section>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {canNote &&
                  (noted ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Check aria-hidden className="size-3" /> Saved as a private note
                    </span>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={pending}
                      onClick={saveNote}
                    >
                      <NotebookPen aria-hidden /> Save as private note
                    </Button>
                  ))}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  disabled={pending}
                  onClick={summarise}
                >
                  Summarise again
                </Button>
                <span className="text-xs text-muted-foreground">
                  Written by MeroAI from the emails; check anything important.
                </span>
              </div>
            </div>
          ))}

        {tab === 'ask' && (
          <div className="flex flex-col gap-2">
            {answers.length === 0 && (
              <div className="flex flex-wrap gap-1.5">
                {THREAD_QUESTIONS.map((text) => (
                  <button
                    key={text}
                    type="button"
                    disabled={pending}
                    onClick={() => ask(text)}
                    className="rounded-full border bg-card px-2.5 py-0.5 text-xs hover:bg-muted"
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}
            {answers.length > 0 && (
              <ol className="flex flex-col gap-2 text-sm" aria-live="polite">
                {answers.map((item, index) => (
                  <li key={index} className="flex flex-col gap-1">
                    <p className="self-end rounded-lg bg-accent px-2.5 py-1">{item.question}</p>
                    <p
                      className={cn(
                        'rounded-lg border bg-card px-2.5 py-1.5 whitespace-pre-line',
                        !item.found && 'text-muted-foreground',
                      )}
                      data-sensitive
                    >
                      {item.answer}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                ask(question);
              }}
            >
              <label htmlFor={`meroai-ask-${conversationId}`} className="sr-only">
                Ask about this thread
              </label>
              <Input
                id={`meroai-ask-${conversationId}`}
                value={question}
                maxLength={1000}
                disabled={pending}
                placeholder="Ask anything about this thread"
                onChange={(event) => setQuestion(event.target.value)}
              />
              <Button type="submit" size="sm" disabled={pending || question.trim().length < 2}>
                {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Send aria-hidden />}
                <span className="sr-only sm:not-sr-only">Ask</span>
              </Button>
              {answers.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="Clear the questions"
                  onClick={() => setAnswers([])}
                >
                  <X aria-hidden />
                </Button>
              )}
            </form>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive-text">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}

/* ---------------------------------------------------------------------- the whole inbox */

const INBOX_QUESTIONS = [
  'Which emails need a reply?',
  'Is anything urgent?',
  'Which customers sound unhappy?',
  'Summarise my unread emails',
  'What are customers asking about most?',
];

/** The answer's words, with each [T3] that MeroAI named shown as a link to that thread. */
function AnswerText({ answer }: { answer: InboxAnswer }) {
  const byRef = new Map(answer.threads.map((thread) => [thread.ref, thread]));
  const parts = answer.answer.split(/(\[T\d{1,3}\])/g);
  return (
    <p className="whitespace-pre-line" data-sensitive>
      {parts.map((part, index) => {
        const ref = /^\[(T\d{1,3})\]$/.exec(part)?.[1];
        if (!ref) return part;
        const thread = byRef.get(ref);
        // A ref that is not a thread MeroAI was shown is dropped, never linked.
        if (!thread) return null;
        return (
          <Link
            key={index}
            href={`/email/${thread.id}`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {thread.name}
          </Link>
        );
      })}
    </p>
  );
}

/**
 * Ask MeroAI about the inbox (ADR-092): questions answered from the person's most recent email
 * threads, with links to the ones it names.
 */
export function MeroAIInbox() {
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<{ question: string; answer: InboxAnswer }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ask = (text: string) => {
    const asked = text.trim();
    if (asked.length < 2) return;
    startTransition(async () => {
      setError(null);
      const result = await askEmailInboxAction({ question: asked });
      if (!result.ok) {
        setError(messageOf(result));
        return;
      }
      setAnswers((list) => [{ question: asked, answer: result.data }, ...list].slice(0, 10));
      setQuestion('');
    });
  };

  return (
    <section
      aria-labelledby="meroai-inbox-title"
      className="meroai-edge meroai-surface flex min-h-[32rem] flex-1 flex-col gap-4 overflow-y-auto rounded-xl p-4"
    >
      <header className="flex items-center gap-3">
        <MeroOrb size={36} state={pending ? 'thinking' : 'idle'} />
        <div>
          <h2 id="meroai-inbox-title" className="text-lg font-semibold tracking-tight">
            Ask <span className="meroai-text">MeroAI</span> about your inbox
          </h2>
          <p className="text-sm text-muted-foreground">
            Answers come from your 40 most recent email threads. Private notes and email addresses
            are never sent to MeroAI.
          </p>
        </div>
      </header>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          ask(question);
        }}
      >
        <label htmlFor="meroai-inbox-question" className="sr-only">
          Your question
        </label>
        <Input
          id="meroai-inbox-question"
          value={question}
          maxLength={1000}
          disabled={pending}
          autoFocus
          placeholder="For example: who is waiting on a quote?"
          onChange={(event) => setQuestion(event.target.value)}
        />
        <Button
          type="submit"
          className="meroai-button"
          disabled={pending || question.trim().length < 2}
        >
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Send aria-hidden />}
          Ask
        </Button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {INBOX_QUESTIONS.map((text) => (
          <button
            key={text}
            type="button"
            disabled={pending}
            onClick={() => ask(text)}
            className="rounded-full border bg-card px-3 py-1 text-sm hover:bg-muted"
          >
            {text}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
      {pending && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> MeroAI is reading your inbox…
        </p>
      )}
      <ol className="flex flex-col gap-3" aria-live="polite">
        {answers.map((item, index) => (
          <li
            key={answers.length - index}
            className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm"
          >
            <p className="font-medium">{item.question}</p>
            <AnswerText answer={item.answer} />
            {item.answer.threads.length > 0 && (
              <ul className="flex flex-col divide-y rounded-md border">
                {item.answer.threads.map((thread) => (
                  <li key={thread.id}>
                    <Link
                      href={`/email/${thread.id}`}
                      className="flex min-w-0 flex-col px-2.5 py-1.5 hover:bg-muted/60"
                    >
                      <span className="truncate font-medium" data-sensitive>
                        {thread.name}
                      </span>
                      <span className="truncate text-xs text-muted-foreground" data-sensitive>
                        {thread.subject ?? '(no subject)'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
