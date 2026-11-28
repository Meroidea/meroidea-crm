'use client';

import { createBrowserClient } from '@supabase/ssr';
import { Save } from 'lucide-react';
import { useRef, useState } from 'react';

import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { publicEnv } from '@/lib/env.public';
import { saveSignatureAction, startComposeUploadAction } from '@/modules/social/actions';

import type { EmailDoc } from '../email-doc';
import { MAX_COMPOSE_FILE_BYTES } from '../schemas';
import { EmailEditor, type EmailEditorHandle } from './email-editor';

/**
 * A person's own email signature (ADR-091), written with the same editor as Compose: text,
 * formatting, links and pictures (a logo). Added to new emails and replies as they choose.
 */
export function SignatureForm({
  accountId,
  signature,
}: {
  /** An inbox of the business, which pictures are uploaded for. */
  accountId: string;
  signature: { doc: EmailDoc; useOnNew: boolean; useOnReplies: boolean } | null;
}) {
  const editor = useRef<EmailEditorHandle>(null);
  const [useOnNew, setUseOnNew] = useState(signature?.useOnNew ?? true);
  const [useOnReplies, setUseOnReplies] = useState(signature?.useOnReplies ?? true);
  const [saved, setSaved] = useState(false);
  const { run, error, isPending, setError } = useActionRunner();

  const uploadPicture = async (file: File): Promise<string | null> => {
    setSaved(false);
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
      setError('Pictures can be JPEG, PNG, GIF or WebP.');
      return null;
    }
    if (file.size > MAX_COMPOSE_FILE_BYTES) {
      setError('That picture is too large.');
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

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setSaved(false);
        run(
          () =>
            saveSignatureAction({
              doc: editor.current?.read() ?? [],
              useOnNew,
              useOnReplies,
            }),
          () => setSaved(true),
        );
      }}
    >
      <span id="signature-label" className="text-sm font-medium">
        Signature
      </span>
      <div className="flex min-h-72 flex-col overflow-hidden rounded-xl border bg-card">
        <EmailEditor
          ref={editor}
          aria-labelledby="signature-label"
          initialDoc={signature?.doc ?? null}
          onPicture={uploadPicture}
          onInput={() => setSaved(false)}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={useOnNew}
          onChange={(event) => {
            setUseOnNew(event.target.checked);
            setSaved(false);
          }}
        />
        Add it to new emails
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={useOnReplies}
          onChange={(event) => {
            setUseOnReplies(event.target.checked);
            setSaved(false);
          }}
        />
        Add it to replies and forwards
      </label>
      <ErrorNote error={error} />
      {saved && (
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm">
          Signature saved.
        </p>
      )}
      <Button type="submit" className="w-fit" disabled={isPending}>
        <Save aria-hidden /> {isPending ? 'Saving…' : 'Save signature'}
      </Button>
      <p className="text-xs text-muted-foreground">
        Only you see and use your signature. Leave it empty to remove it.
      </p>
    </form>
  );
}
