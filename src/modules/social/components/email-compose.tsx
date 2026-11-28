'use client';

import { createBrowserClient } from '@supabase/ssr';
import { FileText, ImageIcon, Loader2, Paperclip, Send, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { publicEnv } from '@/lib/env.public';
import { cn } from '@/lib/utils';
import {
  discardDraftAction,
  removeComposeUploadAction,
  saveDraftAction,
  sendComposedEmailAction,
  startComposeUploadAction,
} from '@/modules/social/actions';

import { emailDocText, type EmailDoc } from '../email-doc';
import {
  COMPOSE_FILE_TYPES,
  MAX_COMPOSE_BYTES,
  MAX_COMPOSE_FILE_BYTES,
  MAX_COMPOSE_FILES,
  MAX_EMAIL_RECIPIENTS,
} from '../schemas';
import { EmailEditor, type EmailEditorHandle } from './email-editor';
import { looksLikeEmail, RecipientInput } from './recipient-input';

export type EmailInboxOption = { id: string; address: string; name: string };

type ComposeFile = {
  key: string;
  name: string;
  size: number;
  mimeType: string;
  state: 'uploading' | 'ready' | 'failed';
  path?: string;
  error?: string;
};

const MB = 1024 * 1024;
const sizeLabel = (bytes: number) =>
  bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Compose (ADR-090): a new email in the reading pane, as a desktop mail client writes one. From
 * one of the business's inbox addresses to anyone, with To, Cc and Bcc, a subject, formatted text
 * and files. Files upload as soon as they are chosen; the email goes when Send is pressed, and
 * the thread it opens is shown.
 */
/** What Compose opens with (ADR-091): a draft, a forwarded email, or a signature. */
export type ComposeStart = {
  draftId?: string;
  accountId?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  doc?: EmailDoc | null;
  attachments?: { path: string; fileName: string; mimeType: string; size: number }[];
};

/** How long after the last change a draft is saved. */
const AUTOSAVE_MS = 1500;

export function EmailCompose({
  inboxes,
  start = {},
  timeZone,
}: {
  inboxes: EmailInboxOption[];
  start?: ComposeStart;
  timeZone: string;
}) {
  const router = useRouter();
  const editor = useRef<EmailEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState(
    inboxes.find((inbox) => inbox.id === start.accountId)?.id ?? inboxes[0]?.id ?? '',
  );
  const [to, setTo] = useState<string[]>(start.to ?? []);
  const [cc, setCc] = useState<string[]>(start.cc ?? []);
  const [bcc, setBcc] = useState<string[]>(start.bcc ?? []);
  const [showCc, setShowCc] = useState((start.cc ?? []).length > 0);
  const [showBcc, setShowBcc] = useState((start.bcc ?? []).length > 0);
  const [subject, setSubject] = useState(start.subject ?? '');
  const [files, setFiles] = useState<ComposeFile[]>(
    (start.attachments ?? []).map((file) => ({
      key: file.path,
      name: file.fileName,
      size: file.size,
      mimeType: file.mimeType,
      state: 'ready',
      path: file.path,
    })),
  );
  const [error, setError] = useState<string | null>(null);
  // A forwarded email (files already copied) counts as started, so it is saved and guarded.
  const [dirty, setDirty] = useState(Boolean(start.subject) && !start.draftId);
  const [draftId, setDraftId] = useState<string | null>(start.draftId ?? null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const saving = useRef(false);
  const [discarding, setDiscarding] = useState(false);
  const [sending, startSending] = useTransition();
  const leaving = useRef(false);

  // Closing the tab with an unsent email asks first, as a mail program does.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty && !leaving.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const touch = () => {
    setDirty(true);
    setError(null);
    setVersion((value) => value + 1);
  };

  // Saves the draft a moment after the writer stops (ADR-091): private to them, reopened from
  // Drafts. Files still uploading are saved with the next change.
  useEffect(() => {
    if (!dirty || leaving.current) return;
    const timer = setTimeout(async () => {
      if (saving.current || leaving.current) return;
      saving.current = true;
      const result = await saveDraftAction({
        ...(draftId ? { id: draftId } : {}),
        accountId,
        to,
        cc,
        bcc,
        subject,
        doc: editor.current?.read() ?? [],
        attachments: files
          .filter((file) => file.state === 'ready' && file.path)
          .map((file) => ({
            path: file.path!,
            fileName: file.name,
            mimeType: file.mimeType,
            size: file.size,
          })),
      });
      saving.current = false;
      if (result.ok && !leaving.current) {
        setDraftId(result.data.id);
        setSavedAt(result.data.savedAt);
      }
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // Saves after each change (`version`), with what is on screen then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, dirty]);

  const addFiles = async (chosen: File[]) => {
    touch();
    const room = MAX_COMPOSE_FILES - files.length;
    if (chosen.length > room) {
      setError(`An email can carry at most ${MAX_COMPOSE_FILES} files.`);
      chosen = chosen.slice(0, Math.max(0, room));
    }
    let total = files.reduce((sum, file) => sum + file.size, 0);
    const storage = createBrowserClient(
      publicEnv.supabaseUrl,
      publicEnv.supabasePublishableKey,
    ).storage.from('social-media');
    for (const file of chosen) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      const base = { key, name: file.name, size: file.size, mimeType: file.type };
      const refusal = !(COMPOSE_FILE_TYPES as readonly string[]).includes(file.type)
        ? 'Images, PDF, Word, Excel and PowerPoint files only'
        : file.size > MAX_COMPOSE_FILE_BYTES
          ? `Larger than ${MAX_COMPOSE_FILE_BYTES / MB} MB`
          : total + file.size > MAX_COMPOSE_BYTES
            ? `Files together over ${MAX_COMPOSE_BYTES / MB} MB`
            : null;
      if (refusal) {
        setFiles((list) => [...list, { ...base, state: 'failed', error: refusal }]);
        continue;
      }
      total += file.size;
      setFiles((list) => [...list, { ...base, state: 'uploading' }]);
      const ticket = await startComposeUploadAction({
        accountId,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
      });
      const uploaded = ticket.ok
        ? await storage.uploadToSignedUrl(ticket.data.path, ticket.data.token, file, {
            contentType: file.type,
          })
        : null;
      setFiles((list) =>
        list.map((item) =>
          item.key !== key
            ? item
            : !ticket.ok
              ? { ...item, state: 'failed', error: ticket.error.message }
              : uploaded?.error
                ? { ...item, state: 'failed', error: 'The upload did not finish' }
                : { ...item, state: 'ready', path: ticket.data.path },
        ),
      );
    }
  };

  /** A picture for the text (ADR-091): uploaded like a file, shown in the text, not listed. */
  const uploadPicture = async (file: File): Promise<string | null> => {
    touch();
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
      setError('Pictures can be JPEG, PNG, GIF or WebP.');
      return null;
    }
    if (file.size > MAX_COMPOSE_FILE_BYTES) {
      setError(`Pictures can be up to ${MAX_COMPOSE_FILE_BYTES / MB} MB.`);
      return null;
    }
    const ticket = await startComposeUploadAction({
      accountId,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
    });
    if (!ticket.ok) {
      setError(ticket.error.message);
      return null;
    }
    const uploaded = await createBrowserClient(
      publicEnv.supabaseUrl,
      publicEnv.supabasePublishableKey,
    )
      .storage.from('social-media')
      .uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: file.type });
    if (uploaded.error) {
      setError('The picture did not upload. Try again.');
      return null;
    }
    return ticket.data.path;
  };

  const removeFile = (file: ComposeFile) => {
    setFiles((list) => list.filter((item) => item.key !== file.key));
    if (file.path) void removeComposeUploadAction({ path: file.path });
  };

  const send = () => {
    const doc = editor.current?.read() ?? [];
    const everyone = [...to, ...cc, ...bcc];
    const invalid = everyone.find((address) => !looksLikeEmail(address));
    const problem =
      to.length === 0
        ? 'Add someone to send it to.'
        : invalid
          ? `${invalid} is not an email address.`
          : new Set(everyone).size > MAX_EMAIL_RECIPIENTS
            ? `An email can go to at most ${MAX_EMAIL_RECIPIENTS} people.`
            : !subject.trim()
              ? 'Add a subject.'
              : !emailDocText(doc).trim()
                ? 'Write your email first.'
                : files.some((file) => file.state === 'uploading')
                  ? 'Wait for the files to finish uploading.'
                  : files.some((file) => file.state === 'failed')
                    ? 'Remove the files that could not be attached.'
                    : null;
    if (problem) {
      setError(problem);
      return;
    }
    startSending(async () => {
      leaving.current = true;
      const result = await sendComposedEmailAction({
        accountId,
        ...(draftId ? { draftId } : {}),
        to,
        cc,
        bcc,
        subject,
        doc,
        attachments: files.map((file) => ({
          path: file.path!,
          fileName: file.name,
          mimeType: file.mimeType,
        })),
      });
      if (!result.ok) {
        leaving.current = false;
        setError(Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message);
        return;
      }
      router.push(`/email/${result.data.conversationId}`);
      router.refresh();
    });
  };

  const discard = () => {
    leaving.current = true;
    // The draft and every file put on this email go; a file added since the last save too.
    if (draftId) void discardDraftAction({ id: draftId });
    for (const file of files) if (file.path) void removeComposeUploadAction({ path: file.path });
    router.push(draftId ? '/email/drafts' : '/email');
  };

  const from = inboxes.find((inbox) => inbox.id === accountId) ?? inboxes[0];
  const switchClass = (on: boolean) =>
    cn(
      'rounded px-1.5 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground',
      on && 'text-foreground',
    );

  return (
    <section
      aria-labelledby="compose-title"
      className="flex min-h-[32rem] flex-1 flex-col overflow-hidden rounded-xl border bg-card"
    >
      <h2 id="compose-title" className="sr-only">
        New email
      </h2>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button type="button" onClick={send} disabled={sending}>
          {sending ? <Loader2 aria-hidden className="animate-spin" /> : <Send aria-hidden />}
          {sending ? 'Sending…' : 'Send'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={sending || files.length >= MAX_COMPOSE_FILES}
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip aria-hidden /> Attach
        </Button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept={COMPOSE_FILE_TYPES.join(',')}
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (chosen.length > 0) void addFiles(chosen);
          }}
        />
        <span className="ml-auto text-xs text-muted-foreground" role="status">
          {savedAt
            ? `Draft saved ${new Intl.DateTimeFormat('en-AU', { timeStyle: 'short', timeZone }).format(new Date(savedAt))}`
            : ''}
        </span>
        <Button
          type="button"
          variant="ghost"
          disabled={sending}
          onClick={() => (dirty || draftId ? setDiscarding(true) : discard())}
        >
          <Trash2 aria-hidden /> Discard
        </Button>
      </div>

      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="w-12 shrink-0 text-sm text-muted-foreground">From</span>
        {inboxes.length > 1 ? (
          <select
            aria-label="From"
            className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
            value={accountId}
            disabled={sending || files.length > 0}
            onChange={(event) => setAccountId(event.target.value)}
          >
            {inboxes.map((inbox) => (
              <option key={inbox.id} value={inbox.id}>
                {inbox.name} &lt;{inbox.address}&gt;
              </option>
            ))}
          </select>
        ) : (
          <span className="min-w-0 truncate text-sm">
            {from?.name} <span className="text-muted-foreground">&lt;{from?.address}&gt;</span>
          </span>
        )}
      </div>
      <RecipientInput
        id="compose-to"
        label="To"
        value={to}
        autoFocus
        disabled={sending}
        onChange={(next) => {
          setTo(next);
          touch();
        }}
        action={
          <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
            {!showCc && (
              <button type="button" className={switchClass(false)} onClick={() => setShowCc(true)}>
                Cc
              </button>
            )}
            {!showBcc && (
              <button type="button" className={switchClass(false)} onClick={() => setShowBcc(true)}>
                Bcc
              </button>
            )}
          </div>
        }
      />
      {showCc && (
        <RecipientInput
          id="compose-cc"
          label="Cc"
          value={cc}
          autoFocus
          disabled={sending}
          onChange={(next) => {
            setCc(next);
            touch();
          }}
        />
      )}
      {showBcc && (
        <RecipientInput
          id="compose-bcc"
          label="Bcc"
          value={bcc}
          autoFocus
          disabled={sending}
          onChange={(next) => {
            setBcc(next);
            touch();
          }}
        />
      )}
      <div className="border-b px-3">
        <label htmlFor="compose-subject" className="sr-only">
          Subject
        </label>
        <input
          id="compose-subject"
          className="h-10 w-full bg-transparent text-base font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground"
          placeholder="Add a subject"
          maxLength={200}
          value={subject}
          disabled={sending}
          onChange={(event) => {
            setSubject(event.target.value);
            touch();
          }}
        />
      </div>

      <span id="compose-body-label" className="sr-only">
        Message
      </span>
      <EmailEditor
        ref={editor}
        aria-labelledby="compose-body-label"
        disabled={sending}
        onInput={touch}
        onFiles={(chosen) => void addFiles(chosen)}
        onPicture={uploadPicture}
        initialDoc={start.doc ?? null}
      />

      {files.length > 0 && (
        <ul aria-label="Attached files" className="flex flex-wrap gap-2 border-t px-3 py-2">
          {files.map((file) => {
            const Icon = file.mimeType.startsWith('image/') ? ImageIcon : FileText;
            return (
              <li
                key={file.key}
                className={cn(
                  'flex max-w-xs items-center gap-2 rounded-lg border px-2 py-1.5 text-sm',
                  file.state === 'failed' && 'border-destructive bg-destructive/10',
                )}
              >
                {file.state === 'uploading' ? (
                  <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" />
                ) : (
                  <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0">
                  <span className="block truncate" data-sensitive>
                    {file.name}
                  </span>
                  <span
                    className={cn(
                      'block text-xs',
                      file.state === 'failed' ? 'text-destructive-text' : 'text-muted-foreground',
                    )}
                  >
                    {file.state === 'failed'
                      ? file.error
                      : file.state === 'uploading'
                        ? 'Uploading…'
                        : sizeLabel(file.size)}
                  </span>
                </span>
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-muted"
                  aria-label={`Remove ${file.name}`}
                  disabled={sending}
                  onClick={() => removeFile(file)}
                >
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p
          role="alert"
          className="border-t bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
        >
          {error}
        </p>
      )}

      <AlertDialog open={discarding} onOpenChange={setDiscarding}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this email?</AlertDialogTitle>
            <AlertDialogDescription>
              What you wrote and the files you attached are not kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep writing</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={discard}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
