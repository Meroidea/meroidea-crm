'use client';

import { FileText, Paperclip, Send, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from 'react';

import { MeroOrb } from '@/components/motion/mero-orb';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';

import { askAssistantAction } from '../actions';
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_BYTES } from '../attachments';
import { MAX_HISTORY, MAX_PROMPT_LENGTH } from '../schemas';
import type { AssistantArtifact } from '../types';
import { ArtifactCard } from './artifact-cards';

/** Shown while a request runs; mounted per request, so its clock starts at zero each time. */
function Working() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="mr-4 flex w-fit items-center gap-2.5 rounded-full border bg-card py-1 pr-4 pl-1 text-sm text-muted-foreground shadow-sm">
      <MeroOrb size={28} state="thinking" />
      <span>{seconds < 6 ? 'MeroAI is thinking…' : `Still working… ${seconds}s`}</span>
    </div>
  );
}

type Message = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  fileName?: string;
  artifact?: AssistantArtifact | null;
  failed?: boolean;
};

export type AssistantAbilities = {
  invoices: boolean;
  rosters: boolean;
  contacts: boolean;
  nextActions: boolean;
  saveNotes: boolean;
};

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CONTACT_PAGE = new RegExp(`^/contacts/(${UUID})`, 'i');
const OPPORTUNITY_PAGE = new RegExp(`^/opportunities/(${UUID})`, 'i');

/** The record on screen, so "this contact" means something. Ids only ever leave the page. */
function pageContext(pathname: string): { contactId?: string; opportunityId?: string } {
  const contact = CONTACT_PAGE.exec(pathname)?.[1];
  if (contact) return { contactId: contact };
  const opportunity = OPPORTUNITY_PAGE.exec(pathname)?.[1];
  return opportunity ? { opportunityId: opportunity } : {};
}

/**
 * The AI assistant as a slide-over from the header (ADR-074). It asks, shows a preview card, and
 * the person approves or discards. Conversations live only in this panel: nothing is stored, and
 * closing the browser tab forgets them.
 */
export function AssistantDrawer({
  abilities,
  contactLabel,
}: {
  abilities: AssistantAbilities;
  contactLabel: string;
}) {
  const pathname = usePathname();
  const context = pageContext(pathname);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nextId = useRef(1);
  const fileInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, pending]);

  const send = (text: string, attachment: File | null = file) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    const history = messages
      .filter((message) => !message.failed && message.text)
      .slice(-MAX_HISTORY)
      .map((message) => ({
        role: message.role === 'user' ? ('user' as const) : ('model' as const),
        text: message.text.slice(0, MAX_PROMPT_LENGTH),
      }));
    setMessages((current) => [
      ...current,
      { id: nextId.current++, role: 'user', text: trimmed, fileName: attachment?.name },
    ]);
    setPrompt('');
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';

    startTransition(async () => {
      // On the Roster page, "the roster" means the week on screen (its date is in the address).
      const onRoster = pathname === '/roster';
      const rosterDate = onRoster
        ? (new URLSearchParams(window.location.search).get('date') ?? undefined)
        : undefined;
      const result = await askAssistantAction({
        prompt: trimmed,
        context: {
          ...context,
          ...(onRoster ? { viewingRoster: true } : {}),
          ...(rosterDate && /^\d{4}-\d{2}-\d{2}$/.test(rosterDate) ? { rosterDate } : {}),
        },
        history,
        ...(attachment ? { file: attachment } : {}),
      });
      setMessages((current) => [
        ...current,
        result.ok
          ? {
              id: nextId.current++,
              role: 'assistant',
              text: result.data.reply,
              artifact: result.data.artifact,
            }
          : {
              id: nextId.current++,
              role: 'assistant',
              text: result.error.fieldErrors?.file?.[0] ?? result.error.message,
              failed: true,
            },
      ]);
    });
  };

  const prefill = (text: string) => {
    setPrompt(text);
    requestAnimationFrame(() => {
      textInput.current?.focus();
      textInput.current?.setSelectionRange(text.length, text.length);
    });
  };

  const chooseFile = (chosen: File | undefined) => {
    setFileError(null);
    if (!chosen) return;
    if (chosen.size > MAX_ATTACHMENT_BYTES) {
      setFileError('Attach a file of 4 MB or less.');
      return;
    }
    setFile(chosen);
    if (!prompt.trim()) {
      setPrompt(
        'Summarise this document: the key dates, action items, and any risks or unusual terms.',
      );
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(prompt);
    }
  };

  const onContact = Boolean(context.contactId);
  type Chip = 'follow_up' | 'invoice' | 'roster' | 'document' | 'next';
  const chips: { key: Chip; label: string }[] = [
    ...(abilities.contacts ? [{ key: 'follow_up' as const, label: 'Draft follow-up' }] : []),
    ...(abilities.invoices ? [{ key: 'invoice' as const, label: 'Create invoice' }] : []),
    ...(abilities.rosters ? [{ key: 'roster' as const, label: 'Build roster' }] : []),
    { key: 'document', label: 'Summarise document' },
    ...(abilities.nextActions ? [{ key: 'next' as const, label: 'Next best actions' }] : []),
  ];
  const runChip = (key: Chip) => {
    if (key === 'follow_up') {
      if (onContact)
        send(`Draft a friendly follow-up email to this ${contactLabel.toLowerCase()}.`);
      else prefill('Draft a friendly follow-up email to ');
    } else if (key === 'invoice') {
      prefill(onContact ? 'Create an invoice for this contact for ' : 'Create an invoice for ');
    } else if (key === 'roster') {
      prefill('Build next week’s roster: ');
    } else if (key === 'document') {
      fileInput.current?.click();
    } else {
      send('What should I focus on next?');
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          aria-label="MeroAI"
          title="MeroAI"
          className="meroai-chip h-10 rounded-full px-3"
        >
          <MeroOrb size={30} state={pending ? 'thinking' : 'idle'} />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="meroai-surface gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="flex items-center gap-2.5 text-lg">
            {/* The mark is the name, written in dots; the words are for screen readers. */}
            <MeroOrb size={40} state={pending ? 'thinking' : 'idle'} />
            <span className="sr-only">MeroAI</span>
          </SheetTitle>
          <SheetDescription>
            Drafts and previews only. Nothing is saved or sent until you approve it.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
          {messages.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-6 text-center">
              <MeroOrb size={132} state={pending ? 'thinking' : 'idle'} />
              <div className="flex flex-col gap-1">
                <p className="text-lg font-semibold tracking-tight">
                  Hi, I’m <span className="meroai-text">MeroAI</span>
                </p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  Ask in your own words, or start with one of the suggestions below.
                </p>
                {onContact && (
                  <p className="text-xs text-muted-foreground">
                    I can see which {contactLabel.toLowerCase()} you have open.
                  </p>
                )}
              </div>
            </div>
          )}
          {messages.map((message) =>
            message.role === 'user' ? (
              <div key={message.id} className="ml-8 flex flex-col items-end gap-1">
                <p className="rounded-lg bg-primary px-3 py-2 text-sm whitespace-pre-line text-primary-foreground">
                  {message.text}
                </p>
                {message.fileName && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <FileText className="size-3" aria-hidden /> {message.fileName}
                  </span>
                )}
              </div>
            ) : (
              <div key={message.id} className="mr-4 flex flex-col gap-2">
                <p
                  className={
                    message.failed
                      ? 'rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive-text'
                      : 'rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-line'
                  }
                  role={message.failed ? 'alert' : undefined}
                >
                  {message.text}
                </p>
                {message.artifact && (
                  <ArtifactCard artifact={message.artifact} canSaveNotes={abilities.saveNotes} />
                )}
              </div>
            ),
          )}
          {pending && <Working />}
          <div ref={endRef} />
        </div>

        <div className="flex flex-col gap-2 border-t p-3">
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <Button
                key={chip.key}
                type="button"
                variant="outline"
                size="xs"
                onClick={() => runChip(chip.key)}
                disabled={pending}
              >
                {chip.label}
              </Button>
            ))}
          </div>
          {file && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1 text-xs">
              <span className="flex min-w-0 items-center gap-1">
                <FileText className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{file.name}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Remove the file"
                onClick={() => {
                  setFile(null);
                  if (fileInput.current) fileInput.current.value = '';
                }}
              >
                <X aria-hidden />
              </Button>
            </div>
          )}
          {fileError && (
            <p role="alert" className="text-xs text-destructive-text">
              {fileError}
            </p>
          )}
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              send(prompt);
            }}
          >
            <input
              ref={fileInput}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              className="hidden"
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Attach a document"
              title="Attach a PDF, image or text file (up to 4 MB)"
              onClick={() => fileInput.current?.click()}
              disabled={pending}
            >
              <Paperclip aria-hidden />
            </Button>
            <Textarea
              ref={textInput}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask MeroAI…"
              aria-label="Ask MeroAI"
              maxLength={MAX_PROMPT_LENGTH}
              rows={2}
              className="max-h-40 min-h-10 flex-1 resize-none"
            />
            <Button
              type="submit"
              size="icon"
              className="meroai-button rounded-full"
              aria-label="Send"
              disabled={pending || !prompt.trim()}
            >
              <Send aria-hidden />
            </Button>
          </form>
          <p className="text-[11px] text-muted-foreground">
            AI can be wrong. Check every draft before you approve it.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
