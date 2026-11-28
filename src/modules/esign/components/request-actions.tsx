'use client';

import { Ban, Download, FileSignature, RotateCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  createSignRequestAction,
  getSignedDownloadUrlAction,
  remindSignerAction,
  voidSignRequestAction,
} from '@/modules/esign/actions';

import { InvitationLinks } from './request-editor';

export function RequestSignaturesButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await createSignRequestAction({ documentId });
            if (result.ok) router.push(`/documents/signatures/${result.data.id}`);
            else setError(result.error.message);
          })
        }
      >
        <FileSignature aria-hidden /> Request signatures
      </Button>
      {error && (
        <p role="alert" className="max-w-xs text-right text-xs text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}

export function ResendLinkButton({
  requestId,
  signerId,
  name,
}: {
  requestId: string;
  signerId: string;
  name: string;
}) {
  const router = useRouter();
  const [result, setResult] = useState<
    { signerId: string; name: string; emailed: boolean; link: string | null }[] | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (result) {
    return (
      <div className="w-full">
        <InvitationLinks
          invitations={result}
          onDone={() => {
            setResult(null);
            router.refresh();
          }}
        />
      </div>
    );
  }
  return (
    <span className="flex items-center gap-2">
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isPending}
        aria-label={`Send ${name} a new link`}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const sent = await remindSignerAction({ id: requestId, signerId });
            if (!sent.ok) setMessage(sent.error.message);
            else if (sent.data.emailed) {
              setMessage('New link emailed');
              router.refresh();
            } else setResult([sent.data]);
          })
        }
      >
        <RotateCw aria-hidden /> Resend link
      </Button>
    </span>
  );
}

export function VoidRequestButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Ban aria-hidden /> Void
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Void this request</SheetTitle>
            <SheetDescription>
              Every link stops working at once and nobody else can sign. Signers who were invited
              are emailed your note. This cannot be undone.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 px-4">
            <Textarea
              aria-label="Note to the signers"
              placeholder="e.g. We sent the wrong version; a new one is on its way."
              value={reason}
              maxLength={500}
              rows={4}
              onChange={(event) => setReason(event.target.value)}
            />
            {error && (
              <p role="alert" className="text-sm text-destructive-text">
                {error}
              </p>
            )}
          </div>
          <SheetFooter>
            <Button
              type="button"
              variant="destructive"
              disabled={isPending || !reason.trim()}
              onClick={() =>
                startTransition(async () => {
                  const result = await voidSignRequestAction({ id: requestId, reason });
                  if (result.ok) {
                    setOpen(false);
                    router.refresh();
                  } else setError(result.error.message);
                })
              }
            >
              Void request
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function DownloadSignedButton({ requestId }: { requestId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await getSignedDownloadUrlAction({ id: requestId });
            if (result.ok) window.location.assign(result.data.url);
            else setError(result.error.message);
          })
        }
      >
        <Download aria-hidden /> Download signed copy
      </Button>
      {error && <span className="text-xs text-destructive-text">{error}</span>}
    </span>
  );
}
