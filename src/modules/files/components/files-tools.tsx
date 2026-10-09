'use client';

import { createBrowserClient } from '@supabase/ssr';
import { Download, Pencil, Trash2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { publicEnv } from '@/lib/env.public';
import {
  deleteDocumentAction,
  finishUploadAction,
  getDownloadUrlAction,
  renameDocumentAction,
  startUploadAction,
} from '@/modules/files/actions';
import { DOCUMENT_FORMATS, MAX_DOCUMENT_BYTES, splitFileName } from '@/modules/files/formats';

/**
 * Adds files to the library. The server issues a one-time ticket for each file, the browser
 * sends the bytes straight to storage with it, and the server then checks what arrived.
 */
export function UploadButton({ folders }: { folders: string[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [folder, setFolder] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const upload = (files: FileList | null) => {
    if (!files?.length) return;
    startTransition(async () => {
      setError(null);
      const storage = createBrowserClient(
        publicEnv.supabaseUrl,
        publicEnv.supabasePublishableKey,
      ).storage.from('documents');
      let added = 0;
      for (const file of files) {
        setStatus(`Uploading ${file.name}…`);
        const parts = splitFileName(file.name);
        if (!parts) {
          setError(`${file.name}: only Word, Excel, PowerPoint and PDF files can be added.`);
          continue;
        }
        if (file.size > MAX_DOCUMENT_BYTES) {
          setError(`${file.name}: files can be up to 15 MB.`);
          continue;
        }
        const ticket = await startUploadAction({ fileName: file.name, sizeBytes: file.size });
        if (!ticket.ok) {
          setError(`${file.name}: ${ticket.error.message}`);
          continue;
        }
        const sent = await storage.uploadToSignedUrl(ticket.data.path, ticket.data.token, file, {
          contentType: DOCUMENT_FORMATS[parts.extension].mimeType,
        });
        if (sent.error) {
          setError(`${file.name}: the upload did not complete. Try again.`);
          continue;
        }
        const saved = await finishUploadAction({
          path: ticket.data.path,
          fileName: file.name,
          folder,
        });
        if (!saved.ok) {
          setError(`${file.name}: ${saved.error.message}`);
          continue;
        }
        added += 1;
      }
      setStatus(added > 0 ? `${added} ${added === 1 ? 'document' : 'documents'} added.` : null);
      if (input.current) input.current.value = '';
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Input
          aria-label="Folder for new uploads"
          placeholder="Folder (optional)"
          list="document-folders"
          value={folder}
          maxLength={80}
          onChange={(event) => setFolder(event.target.value)}
          className="h-8 w-44"
        />
        <datalist id="document-folders">
          {folders.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <input
          ref={input}
          id="document-upload"
          type="file"
          multiple
          accept=".docx,.xlsx,.pptx,.pdf"
          className="sr-only"
          onChange={(event) => upload(event.target.files)}
        />
        <Button asChild disabled={isPending}>
          <label htmlFor="document-upload" className="cursor-pointer">
            <Upload aria-hidden /> Upload
          </label>
        </Button>
      </div>
      {status && !error && (
        <p role="status" className="text-xs text-muted-foreground">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="max-w-sm text-right text-xs text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}

export function DownloadButton({
  id,
  version,
  label = 'Download',
  compact = false,
}: {
  id: string;
  version?: number;
  label?: string;
  compact?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <>
      <Button
        variant="outline"
        size={compact ? 'sm' : 'default'}
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await getDownloadUrlAction({ id, version });
            if (!result.ok) return setError(result.error.message);
            // A short-lived link from the server; opening it starts the download.
            window.location.assign(result.data.url);
          })
        }
      >
        <Download aria-hidden /> {label}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive-text">
          {error}
        </span>
      )}
    </>
  );
}

export function ManageDocument({
  id,
  name,
  folder,
  folders,
}: {
  id: string;
  name: string;
  folder: string | null;
  folders: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nextName, setNextName] = useState(name);
  const [nextFolder, setNextFolder] = useState(folder ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = await renameDocumentAction({ id, name: nextName, folder: nextFolder });
      if (!result.ok) return setError(result.error.fieldErrors?.name?.[0] ?? result.error.message);
      setOpen(false);
      router.refresh();
    });

  const remove = () => {
    if (!window.confirm(`Delete “${name}”? It leaves the library for everyone.`)) return;
    startTransition(async () => {
      const result = await deleteDocumentAction({ id });
      if (!result.ok) return setError(result.error.message);
      router.push('/documents');
      router.refresh();
    });
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil aria-hidden /> Rename or move
      </Button>
      <Button
        variant="outline"
        className="text-destructive-text"
        disabled={isPending}
        onClick={remove}
      >
        <Trash2 aria-hidden /> Delete
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Rename or move</SheetTitle>
            <SheetDescription>
              Changes the name people see and the folder it sits in.
            </SheetDescription>
          </SheetHeader>
          <form
            className="flex flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="flex flex-col gap-4 px-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="document-name">Name</Label>
                <Input
                  id="document-name"
                  required
                  maxLength={200}
                  value={nextName}
                  onChange={(event) => setNextName(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="document-folder">Folder</Label>
                <Input
                  id="document-folder"
                  list="document-folders-edit"
                  maxLength={80}
                  placeholder="None"
                  value={nextFolder}
                  onChange={(event) => setNextFolder(event.target.value)}
                />
                <datalist id="document-folders-edit">
                  {folders.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive-text">
                  {error}
                </p>
              )}
            </div>
            <SheetFooter className="flex-row justify-end">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                Save
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
