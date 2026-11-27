'use client';

import { BadgeCheck, FileQuestion } from 'lucide-react';
import { useState, useTransition } from 'react';

import { Label } from '@/components/ui/label';
import { verifySignedDocumentAction } from '@/modules/esign/public-actions';

type Verified = {
  title: string;
  businessName: string;
  completedAt: Date;
  signers: { name: string; signedAt: Date | null }[];
};

const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

const when = (date: Date | null) =>
  date
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(date),
      )
    : '';

/**
 * Checks a signed file without uploading it: the fingerprint is worked out in the browser and
 * only that is sent. A file changed in any way after signing has a different fingerprint.
 */
export function VerifyDocument() {
  const [result, setResult] = useState<
    { state: 'match'; data: Verified; sha256: string } | { state: 'none'; sha256: string } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const check = (file: File | undefined) => {
    if (!file) return;
    startTransition(async () => {
      setError(null);
      setResult(null);
      const sha256 = hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
      const response = await verifySignedDocumentAction({ sha256 });
      if (!response.ok) setError(response.error.message);
      else if (response.data) setResult({ state: 'match', data: response.data, sha256 });
      else setResult({ state: 'none', sha256 });
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="verify-file">Signed PDF</Label>
        <input
          id="verify-file"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => check(event.target.files?.[0])}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
        <p className="text-xs text-muted-foreground">
          The file stays on your device. Only its SHA-256 fingerprint is sent.
        </p>
      </div>
      {isPending && <p className="text-sm text-muted-foreground">Checking…</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
      {result?.state === 'match' && (
        <section className="flex flex-col gap-3 rounded-xl border border-chart-1/40 bg-chart-1/5 p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <BadgeCheck aria-hidden className="size-5 text-chart-1" /> Genuine and unchanged
          </h2>
          <p className="text-sm">
            This is exactly the file produced when everyone signed “{result.data.title}” for{' '}
            {result.data.businessName}, completed {when(result.data.completedAt)}.
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {result.data.signers.map((signer) => (
              <li key={`${signer.name}-${String(signer.signedAt)}`}>
                {signer.name}{' '}
                <span className="text-muted-foreground">signed {when(signer.signedAt)}</span>
              </li>
            ))}
          </ul>
          <p className="font-mono text-xs break-all text-muted-foreground">{result.sha256}</p>
        </section>
      )}
      {result?.state === 'none' && (
        <section className="flex flex-col gap-2 rounded-xl border border-warning-border bg-warning p-4 text-warning-text">
          <h2 className="flex items-center gap-2 font-semibold">
            <FileQuestion aria-hidden className="size-5" /> No match
          </h2>
          <p className="text-sm">
            This file was not produced by Meroidea e-sign, or it has been changed since it was
            signed. Even re-saving a PDF changes its fingerprint, so ask the sender for the copy
            they received by email.
          </p>
          <p className="font-mono text-xs break-all">{result.sha256}</p>
        </section>
      )}
    </div>
  );
}
