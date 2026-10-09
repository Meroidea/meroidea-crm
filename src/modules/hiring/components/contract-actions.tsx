'use client';

import { Check, Copy, MailCheck, Send, Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { sendContractAction, withdrawContractAction } from '@/modules/hiring/actions';
import type { ContractStatus } from '@/modules/hiring/types';

/** Send, re-send and withdraw. The link is shown once, right after sending, to copy if needed. */
export function ContractActions({
  contractId,
  status,
  email,
}: {
  contractId: string;
  status: ContractStatus;
  email: string;
}) {
  const router = useRouter();
  const [sent, setSent] = useState<{ link: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const send = () =>
    startTransition(async () => {
      setError(null);
      const result = await sendContractAction({ id: contractId });
      if (!result.ok) return setError(result.error.message);
      setSent(result.data);
      router.refresh();
    });

  const withdraw = () =>
    startTransition(async () => {
      setError(null);
      const result = await withdrawContractAction({ id: contractId });
      if (!result.ok) return setError(result.error.message);
      setSent(null);
      router.refresh();
    });

  if (status !== 'draft' && status !== 'sent') return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={send} disabled={isPending}>
          <Send aria-hidden /> {status === 'draft' ? 'Send for acceptance' : 'Send a new link'}
        </Button>
        {status === 'sent' && (
          <Button variant="outline" onClick={withdraw} disabled={isPending}>
            <Undo2 aria-hidden /> Withdraw offer
          </Button>
        )}
      </div>

      {sent && (
        <div className="rounded-lg border bg-muted/60 p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <MailCheck aria-hidden className="size-4 text-primary" />
            {sent.emailed
              ? `Emailed to ${email}.`
              : 'Not emailed: email sending is not set up, or the message could not be sent.'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {sent.emailed
              ? 'You can also pass this link on yourself. It is shown only now.'
              : 'Copy this link and send it to them yourself. It is shown only now.'}{' '}
            Any earlier link has stopped working.
          </p>
          <div className="mt-2 flex gap-2">
            <Input
              readOnly
              value={sent.link}
              aria-label="One-time link"
              onFocus={(e) => e.target.select()}
            />
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(sent.link);
                setCopied(true);
              }}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}
