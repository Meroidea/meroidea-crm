'use client';

import { Check, Download, Mail, PenLine } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { FIELD_KIND_LABELS } from '@/modules/esign/geometry';
import {
  declineSigningAction,
  sendSigningCodeAction,
  submitSignatureAction,
  verifySigningCodeAction,
} from '@/modules/esign/public-actions';
import type { SigningView } from '@/modules/esign/types';

import { PdfPages } from './pdf-pages';
import { SignaturePad } from './signature-pad';

type Field = SigningView['fields'][number];

/**
 * A font size that fits the text in its field both ways, like the server's stamping: at most
 * about 70% of the box's height, and narrow enough for the text (about half an em per character).
 */
const fitted = (text: string) => ({
  fontSize: `min(16px, 62cqh, ${Math.round(185 / Math.max(text.length, 4))}cqw)`,
});

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 4);

export function CodeGate({ token, maskedEmail }: { token: string; maskedEmail: string }) {
  const router = useRouter();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const send = () =>
    startTransition(async () => {
      setError(null);
      const result = await sendSigningCodeAction({ token });
      if (result.ok) setSent(true);
      else setError(result.error.message);
    });

  const verify = () =>
    startTransition(async () => {
      setError(null);
      const result = await verifySigningCodeAction({ token, code });
      if (result.ok) router.refresh();
      else setError(result.error.message);
    });

  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
      <div className="flex items-start gap-3">
        <Mail aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <h2 className="font-semibold">First, confirm it’s you</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            We’ll email a 6-digit code to <strong>{maskedEmail}</strong>, the address this request
            was sent to.
          </p>
        </div>
      </div>
      {sent ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            verify();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signing-code">Code from the email</Label>
            <Input
              id="signing-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              className="max-w-40 text-lg tracking-[0.3em]"
              autoFocus
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isPending || code.length !== 6}>
              Continue
            </Button>
            <Button type="button" variant="ghost" onClick={send} disabled={isPending}>
              Send a new code
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button type="button" onClick={send} disabled={isPending}>
            Email me a code
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </section>
  );
}

export function SigningForm({ token, view }: { token: string; view: SigningView }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      view.fields.map((field) => [
        field.id,
        field.kind === 'name' ? view.signerName : field.kind === 'checkbox' ? 'false' : '',
      ]),
    ),
  );
  const [signature, setSignature] = useState<string | null>(null);
  const [initials, setInitials] = useState<string | null>(null);
  const [capture, setCapture] = useState<'signature' | 'initials' | null>(null);
  const [editing, setEditing] = useState<Field | null>(null);
  const [draft, setDraft] = useState('');
  const [consent, setConsent] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const today = useMemo(
    () =>
      new Intl.DateTimeFormat('en-AU', {
        timeZone: view.timezone,
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(new Date()),
    [view.timezone],
  );

  const done = (field: Field) => {
    switch (field.kind) {
      case 'signature':
        return Boolean(signature);
      case 'initials':
        return Boolean(initials);
      case 'date':
        return true;
      case 'checkbox':
        return !field.required || values[field.id] === 'true';
      default:
        return !field.required || Boolean(values[field.id]?.trim());
    }
  };
  const remaining = view.fields.filter((field) => !done(field));
  const ready = remaining.length === 0 && consent;

  const open = (field: Field) => {
    if (field.kind === 'signature' || field.kind === 'initials') setCapture(field.kind);
    else if (field.kind === 'checkbox') {
      setValues((current) => ({
        ...current,
        [field.id]: current[field.id] === 'true' ? 'false' : 'true',
      }));
    } else if (field.kind === 'name' || field.kind === 'text') {
      setDraft(values[field.id] ?? '');
      setEditing(field);
    }
  };

  const goToNext = () => {
    const next = remaining[0];
    if (!next) return;
    document
      .getElementById(`field-${next.id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    open(next);
  };

  const submit = () =>
    startTransition(async () => {
      setError(null);
      if (!signature) {
        setError('Add your signature first.');
        return;
      }
      const result = await submitSignatureAction({
        token,
        consent: true,
        signature,
        initials,
        values: view.fields
          .filter((field) => field.kind !== 'signature' && field.kind !== 'initials')
          .map((field) => ({ fieldId: field.id, value: values[field.id] ?? '' })),
      });
      if (result.ok) router.refresh();
      else setError(result.error.message);
    });

  const decline = () =>
    startTransition(async () => {
      setError(null);
      const result = await declineSigningAction({ token, reason });
      if (result.ok) {
        setDeclining(false);
        router.refresh();
      } else setError(result.error.message);
    });

  return (
    <div className="flex flex-col gap-4 pb-56 sm:pb-44">
      <PdfPages
        url={`/api/esign/sign/${token}/document`}
        overlay={(page) =>
          view.fields
            .filter((field) => field.page === page)
            .map((field) => {
              const filled =
                done(field) && (field.kind !== 'checkbox' || values[field.id] === 'true');
              const image =
                field.kind === 'signature'
                  ? signature
                  : field.kind === 'initials'
                    ? initials
                    : null;
              return (
                <button
                  key={field.id}
                  id={`field-${field.id}`}
                  type="button"
                  onClick={() => open(field)}
                  aria-label={`${FIELD_KIND_LABELS[field.kind]}${field.required ? ' (required)' : ''}`}
                  className={cn(
                    'absolute flex items-center justify-center overflow-hidden rounded-sm border-2 leading-none font-medium',
                    filled
                      ? 'border-transparent bg-transparent hover:border-primary/40'
                      : 'animate-pulse border-primary bg-primary/10 text-primary',
                    field.kind === 'date' &&
                      'animate-none border-dashed border-primary/40 bg-transparent',
                  )}
                  style={{
                    left: `${field.x * 100}%`,
                    top: `${field.y * 100}%`,
                    width: `${field.width * 100}%`,
                    height: `${field.height * 100}%`,
                    // Text fits the box both ways, as it is drawn on the signed file.
                    containerType: 'size',
                  }}
                >
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a local data URL
                    <img
                      src={`data:image/png;base64,${image}`}
                      alt=""
                      className="size-full object-contain"
                    />
                  ) : field.kind === 'checkbox' ? (
                    values[field.id] === 'true' ? (
                      <Check aria-hidden className="size-full text-foreground" />
                    ) : null
                  ) : field.kind === 'date' ? (
                    <span className="truncate px-1 text-foreground" style={fitted(today)}>
                      {today}
                    </span>
                  ) : values[field.id] ? (
                    <span
                      className="w-full truncate px-1 text-left text-foreground"
                      style={fitted(values[field.id] ?? '')}
                    >
                      {values[field.id]}
                    </span>
                  ) : (
                    <span
                      className="truncate px-1"
                      style={fitted(field.label || FIELD_KIND_LABELS[field.kind])}
                    >
                      {field.label || FIELD_KIND_LABELS[field.kind]}
                    </span>
                  )}
                </button>
              );
            })
        }
      />

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 px-4 py-3 shadow-[0_-4px_16px_rgb(0_0_0/0.06)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              {remaining.length === 0
                ? 'All your fields are done.'
                : `${remaining.length} ${remaining.length === 1 ? 'field' : 'fields'} left to fill`}
            </span>
            {remaining.length > 0 && (
              <Button type="button" size="sm" variant="outline" onClick={goToNext}>
                <PenLine aria-hidden /> Next field
              </Button>
            )}
          </div>
          <label className="flex items-start gap-2.5 text-xs sm:text-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span>
              I agree to sign electronically. My electronic signature is the legal equivalent of my
              handwritten signature on this document, and I agree to do business with{' '}
              {view.businessName} electronically.
            </span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={submit} disabled={!ready || isPending}>
              <Check aria-hidden /> Finish and sign
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeclining(true)}
              disabled={isPending}
            >
              Decline
            </Button>
          </div>
        </div>
      </div>

      <Sheet open={capture !== null} onOpenChange={(next) => !next && setCapture(null)}>
        <SheetContent side="bottom" className="mx-auto max-w-xl rounded-t-xl px-4 pb-6">
          <SheetHeader className="px-0">
            <SheetTitle>{capture === 'initials' ? 'Your initials' : 'Your signature'}</SheetTitle>
            <SheetDescription>
              It will be placed in every {capture === 'initials' ? 'initials' : 'signature'} box for
              you on this document.
            </SheetDescription>
          </SheetHeader>
          {capture && (
            <SignaturePad
              key={capture}
              kind={capture}
              defaultText={capture === 'initials' ? initialsOf(view.signerName) : view.signerName}
              onCancel={() => setCapture(null)}
              onDone={(png) => {
                if (capture === 'initials') setInitials(png);
                else setSignature(png);
                setCapture(null);
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={editing !== null} onOpenChange={(next) => !next && setEditing(null)}>
        <SheetContent side="bottom" className="mx-auto max-w-xl rounded-t-xl px-4 pb-6">
          <SheetHeader className="px-0">
            <SheetTitle>
              {editing ? editing.label || FIELD_KIND_LABELS[editing.kind] : ''}
            </SheetTitle>
            <SheetDescription>{editing?.required ? 'Required' : 'Optional'}</SheetDescription>
          </SheetHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (editing) setValues((current) => ({ ...current, [editing.id]: draft.trim() }));
              setEditing(null);
            }}
          >
            <Input
              aria-label={editing ? editing.label || FIELD_KIND_LABELS[editing.kind] : 'Value'}
              value={draft}
              maxLength={editing?.kind === 'name' ? 120 : 500}
              onChange={(event) => setDraft(event.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit">Done</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={declining} onOpenChange={setDeclining}>
        <SheetContent side="bottom" className="mx-auto max-w-xl rounded-t-xl px-4 pb-6">
          <SheetHeader className="px-0">
            <SheetTitle>Decline to sign</SheetTitle>
            <SheetDescription>
              The request closes for everyone, and {view.senderName} sees your reason.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3">
            <Textarea
              aria-label="Your reason"
              value={reason}
              maxLength={500}
              rows={3}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDeclining(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={decline}
                disabled={isPending || !reason.trim()}
              >
                Decline
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function DownloadSigned({ token }: { token: string }) {
  return (
    <Button asChild>
      <a href={`/api/esign/sign/${token}/document?download=1`}>
        <Download aria-hidden /> Download the signed copy
      </a>
    </Button>
  );
}
