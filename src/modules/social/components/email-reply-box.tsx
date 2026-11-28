'use client';

import { FileText, ImageIcon, Loader2, Paperclip, Send, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { ArticlePicker } from '@/modules/kb/components/article-picker';
import { cn } from '@/lib/utils';
import { emailReplyAction, removeComposeUploadAction } from '@/modules/social/actions';

import { emailDocText, type EmailDoc } from '../email-doc';
import { COMPOSE_FILE_TYPES, MAX_COMPOSE_FILE_BYTES, MAX_COMPOSE_FILES } from '../schemas';
import { uploadComposeFile, uploadComposePicture } from './compose-upload';
import { EmailEditor, type EmailEditorHandle } from './email-editor';
import { looksLikeEmail, RecipientInput } from './recipient-input';

/** Asks the reply box to open for Reply (no Cc) or Reply all (these Cc). */
export const EMAIL_REPLY_EVENT = 'meroidea:email-reply';
export type EmailReplyRequest = { cc: string[] };

export function requestEmailReply(request: EmailReplyRequest) {
  window.dispatchEvent(new CustomEvent<EmailReplyRequest>(EMAIL_REPLY_EVENT, { detail: request }));
}

type ReplyFile = {
  key: string;
  name: string;
  size: number;
  mimeType: string;
  state: 'uploading' | 'ready' | 'failed';
  path?: string;
  error?: string;
};

const BLANK: EmailDoc[number] = { type: 'paragraph', content: [] };

/**
 * The reply box of an email thread (ADR-091): formatted text, pictures, files, Cc and Bcc, and
 * the person's signature when they use it on replies. Reply all fills Cc with the others the
 * email was sent to. The reply goes to the thread's person, threaded as every reply is.
 */
export function EmailReplyBox({
  conversationId,
  accountId,
  signature,
  canned = [],
  articles = false,
}: {
  conversationId: string;
  /** The thread's inbox, which files and pictures are uploaded for. */
  accountId: string;
  signature: EmailDoc | null;
  /** Saved replies, as the plain reply box offers them (ADR-068). */
  canned?: { id: string; title: string; body: string }[];
  /** Whether help articles can be linked (ADR-071). */
  articles?: boolean;
}) {
  const router = useRouter();
  const editor = useRef<EmailEditorHandle>(null);
  const box = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [files, setFiles] = useState<ReplyFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const initial: EmailDoc | null = signature ? [BLANK, BLANK, ...signature] : null;

  useEffect(() => {
    const open = (event: Event) => {
      const { cc: copied } = (event as CustomEvent<EmailReplyRequest>).detail;
      setCc(copied);
      setShowCc(copied.length > 0);
      box.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      editor.current?.focus();
    };
    window.addEventListener(EMAIL_REPLY_EVENT, open);
    return () => window.removeEventListener(EMAIL_REPLY_EVENT, open);
  }, []);

  const addFiles = async (chosen: File[]) => {
    setError(null);
    for (const file of chosen.slice(0, Math.max(0, MAX_COMPOSE_FILES - files.length))) {
      const key = `${file.name}-${Math.random().toString(36).slice(2)}`;
      const base = { key, name: file.name, size: file.size, mimeType: file.type };
      const refusal = !(COMPOSE_FILE_TYPES as readonly string[]).includes(file.type)
        ? 'Images, PDF, Word, Excel and PowerPoint only'
        : file.size > MAX_COMPOSE_FILE_BYTES
          ? 'Larger than 10 MB'
          : null;
      if (refusal) {
        setFiles((list) => [...list, { ...base, state: 'failed', error: refusal }]);
        continue;
      }
      setFiles((list) => [...list, { ...base, state: 'uploading' }]);
      const result = await uploadComposeFile(accountId, file);
      setFiles((list) =>
        list.map((item) =>
          item.key !== key
            ? item
            : 'error' in result
              ? { ...item, state: 'failed', error: result.error }
              : { ...item, state: 'ready', path: result.path },
        ),
      );
    }
  };

  const send = () => {
    const doc = editor.current?.read() ?? [];
    const invalid = [...cc, ...bcc].find((address) => !looksLikeEmail(address));
    const words = emailDocText(doc)
      .replace(emailDocText(signature ?? []), '')
      .trim();
    const pictures = doc.some((block) => block.type === 'image');
    const problem = invalid
      ? `${invalid} is not an email address.`
      : !words && !pictures && files.length === 0
        ? 'Write your reply first.'
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
      const result = await emailReplyAction({
        conversationId,
        cc,
        bcc,
        doc,
        attachments: files.map((file) => ({
          path: file.path!,
          fileName: file.name,
          mimeType: file.mimeType,
        })),
      });
      if (!result.ok) {
        setError(Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message);
        router.refresh();
        return;
      }
      setCc([]);
      setBcc([]);
      setShowCc(false);
      setShowBcc(false);
      setFiles([]);
      setError(null);
      editor.current?.load(initial ?? []);
      router.refresh();
    });
  };

  return (
    <div ref={box} className="flex flex-col overflow-hidden rounded-lg border">
      {(showCc || showBcc) && (
        <div>
          {showCc && (
            <RecipientInput
              id={`reply-cc-${conversationId}`}
              label="Cc"
              value={cc}
              disabled={sending}
              onChange={setCc}
            />
          )}
          {showBcc && (
            <RecipientInput
              id={`reply-bcc-${conversationId}`}
              label="Bcc"
              value={bcc}
              disabled={sending}
              onChange={setBcc}
            />
          )}
        </div>
      )}
      <span id={`reply-label-${conversationId}`} className="sr-only">
        Reply
      </span>
      <EmailEditor
        ref={editor}
        compact
        aria-labelledby={`reply-label-${conversationId}`}
        initialDoc={initial}
        disabled={sending}
        onInput={() => setError(null)}
        onFiles={(chosen) => void addFiles(chosen)}
        onPicture={async (file) => {
          const result = await uploadComposePicture(accountId, file);
          if ('error' in result) {
            setError(result.error);
            return null;
          }
          return result.path;
        }}
      />
      {files.length > 0 && (
        <ul aria-label="Attached files" className="flex flex-wrap gap-2 border-t px-3 py-2">
          {files.map((file) => {
            const Icon = file.mimeType.startsWith('image/') ? ImageIcon : FileText;
            return (
              <li
                key={file.key}
                className={cn(
                  'flex max-w-xs items-center gap-2 rounded-lg border px-2 py-1 text-sm',
                  file.state === 'failed' && 'border-destructive bg-destructive/10',
                )}
              >
                {file.state === 'uploading' ? (
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                ) : (
                  <Icon aria-hidden className="size-4 text-muted-foreground" />
                )}
                <span className="min-w-0 truncate" data-sensitive>
                  {file.name}
                  {file.state === 'failed' && (
                    <span className="block text-xs text-destructive-text">{file.error}</span>
                  )}
                </span>
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-muted"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => {
                    setFiles((list) => list.filter((item) => item.key !== file.key));
                    if (file.path) void removeComposeUploadAction({ path: file.path });
                  }}
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
      <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
        <Button type="button" size="sm" onClick={send} disabled={sending}>
          {sending ? <Loader2 aria-hidden className="animate-spin" /> : <Send aria-hidden />}
          {sending ? 'Sending…' : 'Send'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
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
        {articles && (
          <ArticlePicker
            target={{ conversationId }}
            onInsert={(text) => editor.current?.insertText(text)}
          />
        )}
        {canned.length > 0 && (
          <select
            aria-label="Insert a saved reply"
            className="h-8 max-w-44 rounded-md border bg-background px-2 text-sm"
            defaultValue=""
            disabled={sending}
            onChange={(event) => {
              const chosen = canned.find((item) => item.id === event.target.value);
              event.target.value = '';
              if (chosen) editor.current?.insertText(chosen.body);
            }}
          >
            <option value="" disabled>
              Saved replies
            </option>
            {canned.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto flex gap-1">
          {!showCc && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowCc(true)}>
              Cc
            </Button>
          )}
          {!showBcc && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowBcc(true)}>
              Bcc
            </Button>
          )}
        </span>
      </div>
    </div>
  );
}
