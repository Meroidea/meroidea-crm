'use client';

import { Check, Copy, Download, Pencil, Plus, Printer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Field } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  deleteReviewAction,
  handleReviewAction,
  saveReviewLinkAction,
} from '@/modules/reviews/actions';
import {
  DEFAULT_PROMPT,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUSES,
  type ReviewStatus,
} from '@/modules/reviews/schemas';

type Result =
  { ok: true } | { ok: false; error: { message: string; fieldErrors?: Record<string, string[]> } };

function useRun() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const run = (action: () => Promise<Result>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) {
        return setError(
          Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message,
        );
      }
      after?.();
      router.refresh();
    });
  return { run, error, isPending };
}

const ErrorNote = ({ error }: { error: string | null }) =>
  error ? (
    <p role="alert" className="text-sm text-destructive-text">
      {error}
    </p>
  ) : null;

export function ReviewLinkButton({
  link,
}: {
  link?: { id: string; name: string; prompt: string; isActive: boolean };
}) {
  const { run, error, isPending } = useRun();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(link?.name ?? '');
  const [prompt, setPrompt] = useState(link?.prompt ?? DEFAULT_PROMPT);

  return (
    <>
      {link ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          <Pencil aria-hidden /> Edit
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus aria-hidden /> New review link
        </Button>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{link ? 'Edit review link' : 'New review link'}</SheetTitle>
            <SheetDescription>
              Each link has its own address and QR code, so you can see which sign, receipt or
              message your reviews come from.
            </SheetDescription>
          </SheetHeader>
          <form
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={(event) => {
              event.preventDefault();
              run(
                () =>
                  saveReviewLinkAction({
                    id: link?.id,
                    name,
                    prompt,
                    isActive: link?.isActive ?? true,
                  }),
                () => {
                  setOpen(false);
                  if (!link) setName('');
                },
              );
            }}
          >
            <Field
              name="link-name"
              label="Where is it used?"
              hint="Only you see this. For example: Front counter."
            >
              <Input
                id="link-name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field name="link-prompt" label="The question customers see">
              <Input
                id="link-prompt"
                required
                maxLength={160}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </Field>
            <ErrorNote error={error} />
            <SheetFooter className="mt-auto px-0">
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Saving…' : 'Save'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Copy the address, download the QR code, print a counter sign, or switch the link off. */
export function ReviewLinkActions({
  link,
  url,
  qrSvg,
  businessName,
}: {
  link: { id: string; name: string; prompt: string; isActive: boolean };
  url: string;
  /** The QR code for `url`, drawn on the server. */
  qrSvg: string;
  businessName: string;
}) {
  const { run, error, isPending } = useRun();
  const [copied, setCopied] = useState(false);

  /** Opens a clean one-page sign in a new window and prints it. Built from text nodes, not HTML strings. */
  const printSign = () => {
    const sign = window.open('', '_blank', 'width=520,height=720');
    if (!sign) return;
    const doc = sign.document;
    doc.title = `Review sign — ${link.name}`;
    const style = doc.createElement('style');
    style.textContent =
      'body{font-family:system-ui,sans-serif;text-align:center;padding:48px 32px;color:#111}' +
      'h1{font-size:28px;margin:0 0 8px}p{font-size:18px;margin:0 0 28px;color:#444}' +
      'img{width:300px;height:300px}small{display:block;margin-top:20px;font-size:13px;color:#666;word-break:break-all}';
    doc.head.appendChild(style);
    const heading = doc.createElement('h1');
    heading.textContent = businessName;
    const question = doc.createElement('p');
    question.textContent = link.prompt;
    const image = doc.createElement('img');
    image.alt = 'QR code to leave a review';
    image.src = `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`;
    const hint = doc.createElement('p');
    hint.textContent = 'Scan with your phone camera to leave a review';
    hint.style.marginTop = '24px';
    const address = doc.createElement('small');
    address.textContent = url;
    doc.body.append(heading, question, image, hint, address);
    image.onload = () => sign.print();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <Button size="sm" variant="outline" asChild>
          <a
            href={`data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`}
            download={`review-qr-${link.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.svg`}
          >
            <Download aria-hidden /> QR code
          </a>
        </Button>
        <Button size="sm" variant="outline" onClick={printSign}>
          <Printer aria-hidden /> Print sign
        </Button>
        <ReviewLinkButton link={link} />
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => run(() => saveReviewLinkAction({ ...link, isActive: !link.isActive }))}
        >
          {link.isActive ? 'Switch off' : 'Switch on'}
        </Button>
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

/** Mark a review as read or followed up, keep a private note, or remove it. */
export function ReviewHandling({
  id,
  status,
  internalNote,
}: {
  id: string;
  status: ReviewStatus;
  internalNote: string | null;
}) {
  const { run, error, isPending } = useRun();
  const [next, setNext] = useState(status);
  const [note, setNote] = useState(internalNote ?? '');
  const changed = next !== status || note !== (internalNote ?? '');

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => handleReviewAction({ id, status: next, internalNote: note }));
      }}
    >
      <div className="flex flex-wrap gap-2">
        <NativeSelect
          aria-label="Status"
          value={next}
          onChange={(event) => setNext(event.target.value as ReviewStatus)}
          className="h-8 w-auto"
        >
          {REVIEW_STATUSES.map((option) => (
            <option key={option} value={option}>
              {REVIEW_STATUS_LABELS[option]}
            </option>
          ))}
        </NativeSelect>
        <Input
          aria-label="Private note"
          placeholder="Private note: what was done about it"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="h-8 min-w-48 flex-1"
        />
        <Button type="submit" size="sm" disabled={isPending || !changed}>
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => {
            if (window.confirm('Remove this review? This cannot be undone.')) {
              run(() => deleteReviewAction({ id }));
            }
          }}
        >
          Remove
        </Button>
      </div>
      <ErrorNote error={error} />
    </form>
  );
}
