'use client';

import { Check, Copy, ExternalLink, Mail, Send, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { sendInvoiceAction } from '@/modules/invoices/actions';

import { chaseOverdueInvoicesAction, draftInvoiceWithMeroAIAction } from '../actions';
import type { ReminderDraft, ReminderTone } from '../invoice-reminders';
import type { InvoiceDraftArtifact } from '../types';
import { InvoiceCard } from './artifact-cards';

type Mode = 'draft' | 'chase';

const TONE: Record<
  ReminderTone,
  { label: string; variant: 'secondary' | 'outline' | 'destructive' }
> = {
  friendly: { label: 'Friendly reminder', variant: 'secondary' },
  firm: { label: 'Firm reminder', variant: 'outline' },
  final: { label: 'Final notice', variant: 'destructive' },
};

function ReminderCard({ reminder }: { reminder: ReminderDraft }) {
  const [subject, setSubject] = useState(reminder.subject);
  const [body, setBody] = useState(reminder.body);
  const [copied, setCopied] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const tone = TONE[reminder.tone];
  const mailto = reminder.customerEmail
    ? `mailto:${encodeURIComponent(reminder.customerEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : null;

  const resend = () =>
    startTransition(async () => {
      setSendResult(null);
      const result = await sendInvoiceAction({ id: reminder.invoiceId });
      if (!result.ok) setSendResult({ ok: false, text: result.error.message });
      else if (!result.data.sent)
        setSendResult({ ok: false, text: result.data.reason ?? 'Not sent.' });
      else
        setSendResult({
          ok: true,
          text: `Invoice ${reminder.reference} emailed to ${reminder.customerEmail}.`,
        });
    });

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {reminder.reference} · <span className="font-normal">{reminder.customerName}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {formatMoney(reminder.balance, reminder.currency)} owed · due{' '}
            {formatCalendarDate(reminder.dueDate)} · {reminder.daysOverdue} day
            {reminder.daysOverdue === 1 ? '' : 's'} overdue
          </p>
        </div>
        <Badge variant={tone.variant}>{tone.label}</Badge>
      </div>
      <Input
        aria-label={`Subject for ${reminder.reference}`}
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
      />
      <Textarea
        aria-label={`Reminder for ${reminder.reference}`}
        value={body}
        rows={Math.min(12, body.split('\n').length + 1)}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        {mailto ? (
          <Button asChild size="sm">
            <a href={mailto}>
              <Mail aria-hidden /> Open in email app
            </a>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">No email address on this invoice.</span>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        {reminder.customerEmail && (
          <Button size="sm" variant="outline" onClick={resend} disabled={pending}>
            <Send aria-hidden /> {pending ? 'Sending…' : 'Resend invoice'}
          </Button>
        )}
        <Button asChild size="sm" variant="ghost">
          <Link href={`/invoices/${reminder.invoiceId}`}>
            Open invoice <ExternalLink aria-hidden />
          </Link>
        </Button>
      </div>
      {sendResult && (
        <p
          role={sendResult.ok ? 'status' : 'alert'}
          className={cn(
            'text-xs',
            sendResult.ok ? 'text-muted-foreground' : 'text-destructive-text',
          )}
        >
          {sendResult.text}
        </p>
      )}
    </div>
  );
}

/**
 * Ask MeroAI on the invoices page (ADR-077), beside the manual "New invoice": draft an invoice
 * from a sentence, or write reminders for every overdue invoice. Nothing is saved or sent from
 * here without the manager's click.
 */
export function MeroAIInvoicesPanel({
  overdueTotal,
  currency,
  canReadRequests,
}: {
  overdueTotal: string;
  currency: string;
  /** Drafting reads a sentence with a model; chasing needs none. */
  canReadRequests: boolean;
}) {
  const hasOverdue = Number(overdueTotal) > 0;
  const [mode, setMode] = useState<Mode>(canReadRequests ? 'draft' : 'chase');
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<{ reply: string; artifact: InvoiceDraftArtifact } | null>(
    null,
  );
  const [reminders, setReminders] = useState<ReminderDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const draftInvoice = () =>
    startTransition(async () => {
      setError(null);
      setDraft(null);
      const result = await draftInvoiceWithMeroAIAction({ text });
      if (result.ok) setDraft(result.data);
      else setError(result.error.fieldErrors?.text?.[0] ?? result.error.message);
    });

  const chase = () =>
    startTransition(async () => {
      setError(null);
      const result = await chaseOverdueInvoicesAction({});
      if (result.ok) setReminders(result.data);
      else setError(result.error.message);
    });

  return (
    <details
      className="group rounded-xl border border-primary/30 bg-card"
      open={hasOverdue || undefined}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-sm font-medium">
        <Sparkles aria-hidden className="size-4 text-primary" />
        Ask MeroAI
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          Draft an invoice from a sentence, or chase what is overdue
          {hasOverdue && ` (${formatMoney(overdueTotal, currency)})`}
        </span>
      </summary>
      <div className="flex flex-col gap-4 border-t p-4">
        <div
          role="tablist"
          aria-label="What should MeroAI do?"
          className="grid grid-cols-2 gap-2 sm:w-fit"
        >
          {(
            [
              ['draft', 'Draft an invoice'],
              [
                'chase',
                hasOverdue
                  ? `Chase overdue · ${formatMoney(overdueTotal, currency)}`
                  : 'Chase overdue',
              ],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              onClick={() => {
                setMode(key);
                setError(null);
              }}
              className={cn(
                'rounded-lg border px-3 py-2 text-sm transition-colors',
                mode === key ? 'border-primary bg-accent text-accent-foreground' : 'hover:bg-muted',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'draft' &&
          (canReadRequests ? (
            <div className="flex flex-col gap-3">
              <label htmlFor="meroai-invoice" className="text-sm text-muted-foreground">
                Who is it for, and what are you charging? MeroAI finds the customer, works out the
                totals and tax, and shows you the invoice before anything is saved.
              </label>
              <Textarea
                id="meroai-invoice"
                rows={3}
                maxLength={1000}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="For example: Olivia Example, 2 hours consulting at $150 and $40 travel, due in 7 days"
              />
              <Button
                onClick={draftInvoice}
                disabled={pending || text.trim().length < 5}
                className="sm:self-start"
              >
                <Sparkles aria-hidden />
                {pending ? 'MeroAI is drafting…' : 'Draft with MeroAI'}
              </Button>
              {draft && (
                <div className="flex flex-col gap-2" aria-live="polite">
                  <p className="text-sm text-muted-foreground">{draft.reply}</p>
                  <InvoiceCard artifact={draft.artifact} />
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Drafting from a sentence needs MeroAI to be set up with a Gemini API key. Chasing
              overdue invoices works without it.
            </p>
          ))}

        {mode === 'chase' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              A reminder for each overdue invoice, friendlier or firmer depending on how late it is,
              written from the invoice itself. Edit any of them, then send from your own email, or
              resend the invoice.
            </p>
            {reminders === null ? (
              <Button onClick={chase} disabled={pending || !hasOverdue} className="sm:self-start">
                <Sparkles aria-hidden />
                {pending
                  ? 'Writing reminders…'
                  : hasOverdue
                    ? 'Write reminders'
                    : 'Nothing is overdue'}
              </Button>
            ) : reminders.length === 0 ? (
              <p className="text-sm">Nothing is overdue.</p>
            ) : (
              <div className="flex flex-col gap-3" aria-live="polite">
                <p className="text-sm font-medium">
                  {reminders.length} reminder{reminders.length === 1 ? '' : 's'}, most overdue first
                </p>
                {reminders.map((reminder) => (
                  <ReminderCard key={reminder.invoiceId} reminder={reminder} />
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive-text">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
