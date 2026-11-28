import { AlertTriangle, Reply, RotateCcw, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

import { receiptLabel } from '../channel-conventions';
import { EmailDocView } from './email-doc-view';
import { Attachment } from './message-attachment';
import type { ThreadItem } from './thread-view';

/** Who an email thread is between: the customer and the business's inbox address. */
export type EmailParties = {
  customerName: string;
  customerEmail: string | null;
  /** The inbox's display name and address, as replies are sent from them. */
  accountName: string;
  accountAddress: string | null;
};

/**
 * One email in the reading pane (ADR-087): sender and recipient above the message, the date and
 * Reply on the right, as a mail client shows it. The body is plain text: received HTML is never
 * rendered (ADR-070). Older emails in a long thread start folded to their first line.
 */
export function EmailMessage({
  message,
  parties,
  folded,
  canReply,
  busy,
  onReply,
  onRetry,
}: {
  message: ThreadItem;
  parties: EmailParties;
  folded: boolean;
  canReply: boolean;
  busy: boolean;
  onReply: () => void;
  onRetry: (messageId: string) => void;
}) {
  const outbound = message.direction === 'outbound';
  const fromName = outbound ? (message.sentByName ?? parties.accountName) : parties.customerName;
  const fromAddress = outbound ? parties.accountAddress : parties.customerEmail;
  const composed = outbound ? (message.composed ?? null) : null;
  const to =
    composed && composed.to.length > 0
      ? composed.to.join(', ')
      : outbound
        ? (parties.customerEmail ?? parties.customerName)
        : (parties.accountAddress ?? parties.accountName);
  const status = outbound ? receiptLabel('email', message.status) : null;
  const preview = (message.body ?? '').replace(/\s+/g, ' ').trim();

  return (
    <details
      open={!folded}
      className={cn(
        'group rounded-xl border bg-card',
        message.status === 'sending' && 'opacity-70',
        message.status === 'failed' && 'border-destructive',
      )}
    >
      <summary className="flex cursor-pointer list-none items-start gap-3 p-3 sm:p-4 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold sm:size-10 sm:text-sm',
            outbound ? 'bg-primary text-primary-foreground' : 'bg-accent text-foreground',
          )}
        >
          {initials(fromName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-1 text-sm" data-sensitive>
            <span className="font-semibold">{fromName}</span>
            {fromAddress && (
              <span className="truncate text-muted-foreground">&lt;{fromAddress}&gt;</span>
            )}
          </span>
          <span
            className="block truncate text-xs text-muted-foreground group-open:hidden"
            data-sensitive
          >
            {preview || 'No text'}
          </span>
          <span
            className="hidden truncate text-xs text-muted-foreground group-open:block"
            data-sensitive
          >
            To: {to}
          </span>
          {composed && composed.cc.length > 0 && (
            <span
              className="hidden truncate text-xs text-muted-foreground group-open:block"
              data-sensitive
            >
              Cc: {composed.cc.join(', ')}
            </span>
          )}
          {composed && composed.bcc.length > 0 && (
            <span
              className="hidden truncate text-xs text-muted-foreground group-open:block"
              data-sensitive
            >
              Bcc: {composed.bcc.join(', ')}
            </span>
          )}
          <span className="block text-xs text-muted-foreground tabular-nums sm:hidden">
            {message.sentAtLabel}
            {status ? ` · ${status}` : ''}
          </span>
        </span>
        <span className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
          <span className="text-xs text-muted-foreground tabular-nums">{message.sentAtLabel}</span>
          {status && <span className="text-xs text-muted-foreground">{status}</span>}
        </span>
      </summary>

      <div className="flex flex-col gap-3 px-3 pb-3 sm:px-4 sm:pb-4 sm:pl-[4.25rem]">
        {message.unverified && (
          <p className="flex gap-2 rounded-r-lg border-l-4 border-warning-border bg-warning px-3 py-2.5 text-sm text-warning-text">
            <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong>Caution:</strong> this email did not pass the sender checks (DKIM or DMARC),
              so the address it came from may be forged. Do not open its links or files unless you
              recognise the sender.
            </span>
          </p>
        )}
        {message.automated && (
          <p className="text-xs text-muted-foreground">
            An automatic message: an auto-reply or a bounce.
          </p>
        )}
        {composed ? (
          <EmailDocView doc={composed.doc} />
        ) : (
          message.body && (
            <div className="text-sm leading-relaxed break-words whitespace-pre-wrap" data-sensitive>
              {message.body}
            </div>
          )
        )}
        {message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-3 border-t pt-3 text-sm">
            {message.attachments.map((attachment, index) => (
              <Attachment
                key={index}
                messageId={message.id}
                index={index}
                attachment={attachment}
                platformLabel="Email"
              />
            ))}
          </div>
        )}
        {message.status === 'failed' && (
          <p className="flex flex-wrap items-center gap-1 text-xs text-destructive-text">
            <AlertTriangle aria-hidden className="size-3" /> Not sent
            {message.error ? `: ${message.error}` : ''}
            {canReply && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                disabled={busy}
                onClick={() => onRetry(message.id)}
              >
                <RotateCcw aria-hidden className="size-3" /> Retry
              </Button>
            )}
          </p>
        )}
        {!outbound && canReply && (
          <div>
            <Button type="button" variant="outline" size="sm" onClick={onReply}>
              <Reply aria-hidden /> Reply
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}
