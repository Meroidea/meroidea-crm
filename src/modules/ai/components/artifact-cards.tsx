'use client';

import {
  AlertTriangle,
  CalendarClock,
  Check,
  Copy,
  ExternalLink,
  Mail,
  MessageSquare,
} from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { invoiceNumber } from '@/modules/invoices/types';

import { approveInvoiceDraftAction, approveNoteAction, approveRosterAction } from '../actions';
import { ROSTER_STRATEGY_TEXT } from '../types';
import type {
  AssistantArtifact,
  CommunicationDraftArtifact,
  DocumentSummaryArtifact,
  InvoiceDraftArtifact,
  NextActionsArtifact,
  RosterApprovalResult,
  RosterPreviewArtifact,
} from '../types';

type CardState = 'open' | 'discarded';

function CardShell({
  title,
  badge,
  children,
  footer,
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 text-card-foreground">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{title}</p>
        {badge}
      </div>
      {children}
      {footer && <div className="flex flex-wrap items-center gap-2 border-t pt-3">{footer}</div>}
    </div>
  );
}

function Warnings({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 rounded-md bg-muted p-2 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item} className="flex gap-1.5">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
          {item}
        </li>
      ))}
    </ul>
  );
}

function Problem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-destructive-text">
      {message}
    </p>
  );
}

const DraftBadge = () => <Badge variant="secondary">Preview, not saved</Badge>;

function Discarded() {
  return <p className="text-xs text-muted-foreground italic">Discarded. Nothing was saved.</p>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

const hours = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

export function InvoiceCard({ artifact }: { artifact: InvoiceDraftArtifact }) {
  const [state, setState] = useState<CardState>('open');
  const [saved, setSaved] = useState<{ id: string; number: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const money = (value: string) => formatMoney(value, artifact.currency);

  const approve = () =>
    startTransition(async () => {
      setError(null);
      const result = await approveInvoiceDraftAction({
        customerName: artifact.customer.name,
        customerEmail: artifact.customer.email ?? '',
        customerAddress: artifact.customer.address,
        fromDetails: artifact.fromDetails,
        issueDate: artifact.issueDate,
        dueDate: artifact.dueDate,
        taxRate: artifact.taxRate,
        notes: artifact.notes,
        lines: artifact.lines.map(({ description, quantity, unitPrice }) => ({
          description,
          quantity,
          unitPrice,
        })),
      });
      if (result.ok) setSaved(result.data);
      else setError(result.error.message);
    });

  return (
    <CardShell
      title={`Invoice for ${artifact.customer.name}`}
      badge={saved ? <Badge>Saved as draft</Badge> : <DraftBadge />}
      footer={
        saved ? (
          <Button asChild size="sm">
            <Link href={`/invoices/${saved.id}`}>
              Open {invoiceNumber(saved.number)} <ExternalLink aria-hidden />
            </Link>
          </Button>
        ) : state === 'discarded' ? (
          <Discarded />
        ) : (
          <>
            <Button size="sm" onClick={approve} disabled={pending}>
              {pending ? 'Saving…' : 'Approve & save draft'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setState('discarded')}
              disabled={pending}
            >
              Discard
            </Button>
          </>
        )
      }
    >
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Invoice date</dt>
        <dd>{formatCalendarDate(artifact.issueDate)}</dd>
        <dt className="text-muted-foreground">Due</dt>
        <dd>{formatCalendarDate(artifact.dueDate)}</dd>
        {artifact.customer.email && (
          <>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="truncate" data-sensitive>
              {artifact.customer.email}
            </dd>
          </>
        )}
      </dl>
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1 text-left font-normal">Item</th>
            <th className="py-1 text-right font-normal">Qty</th>
            <th className="py-1 text-right font-normal">Amount</th>
          </tr>
        </thead>
        <tbody>
          {artifact.lines.map((line, index) => (
            <tr key={index} className="border-t">
              <td className="py-1 pr-2">
                {line.description}
                <span className="block text-muted-foreground">{money(line.unitPrice)} each</span>
              </td>
              <td className="py-1 text-right tabular-nums">{Number(line.quantity)}</td>
              <td className="py-1 text-right tabular-nums">{money(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="tabular-nums">
          <tr className="border-t">
            <td colSpan={2} className="py-1 text-right text-muted-foreground">
              Subtotal
            </td>
            <td className="py-1 text-right">{money(artifact.subtotal)}</td>
          </tr>
          {Number(artifact.taxRate) > 0 && (
            <tr>
              <td colSpan={2} className="py-1 text-right text-muted-foreground">
                Tax ({Number(artifact.taxRate)}%)
              </td>
              <td className="py-1 text-right">{money(artifact.taxTotal)}</td>
            </tr>
          )}
          <tr className="font-medium">
            <td colSpan={2} className="py-1 text-right">
              Total
            </td>
            <td className="py-1 text-right">{money(artifact.total)}</td>
          </tr>
        </tfoot>
      </table>
      <Warnings items={artifact.warnings} />
      {saved && (
        <p className="text-xs text-muted-foreground">
          Saved as a draft. Nothing has been sent. Review and send it from the invoice.
        </p>
      )}
      <Problem message={error} />
    </CardShell>
  );
}

export function RosterCard({
  artifact,
  onApproved,
}: {
  artifact: RosterPreviewArtifact;
  /** Called once the shifts are saved, e.g. to refresh the roster page underneath. */
  onApproved?: () => void;
}) {
  const [state, setState] = useState<CardState>('open');
  const [result, setResult] = useState<RosterApprovalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const byDate = new Map<string, RosterPreviewArtifact['shifts']>();
  for (const shift of artifact.shifts)
    byDate.set(shift.date, [...(byDate.get(shift.date) ?? []), shift]);

  const approve = () =>
    startTransition(async () => {
      setError(null);
      const response = await approveRosterAction({
        shifts: artifact.shifts.map(
          ({ date, startTime, endTime, userId, teamId, breaks, note }) => ({
            date,
            startTime,
            endTime,
            userId,
            teamId,
            breaks,
            note,
          }),
        ),
      });
      if (response.ok) {
        setResult(response.data);
        onApproved?.();
      } else setError(response.error.message);
    });

  return (
    <CardShell
      title={`${artifact.strategy ? ROSTER_STRATEGY_TEXT[artifact.strategy].title : 'Roster'}, ${formatCalendarDate(artifact.startsOn)} – ${formatCalendarDate(artifact.endsOn)}`}
      badge={result ? <Badge>Added, not published</Badge> : <DraftBadge />}
      footer={
        result ? (
          <Button asChild size="sm">
            <Link href={`/roster?date=${result.firstDate ?? artifact.startsOn}`}>
              Open the roster <ExternalLink aria-hidden />
            </Link>
          </Button>
        ) : state === 'discarded' ? (
          <Discarded />
        ) : (
          <>
            <Button size="sm" onClick={approve} disabled={pending || artifact.shifts.length === 0}>
              {pending ? 'Adding shifts…' : 'Approve & add shifts'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setState('discarded')}
              disabled={pending}
            >
              Discard
            </Button>
          </>
        )
      }
    >
      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
        {[...byDate].map(([date, shifts]) => (
          <div key={date}>
            <p className="text-xs font-medium">{formatCalendarDate(date)}</p>
            <ul className="text-xs">
              {shifts.map((shift, index) => (
                <li
                  key={index}
                  className="flex justify-between gap-2 border-b py-1 last:border-b-0"
                >
                  <span className="text-muted-foreground tabular-nums">
                    {shift.startTime}–{shift.endTime}
                  </span>
                  <span className={shift.userId ? 'truncate' : 'text-destructive-text'}>
                    {shift.personName ?? 'Vacant'}
                    {shift.teamName && (
                      <span className="text-muted-foreground"> · {shift.teamName}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {artifact.estimatedCost && (
        <p className="flex items-baseline justify-between gap-2 rounded-md bg-muted px-2 py-1.5 text-xs">
          <span className="text-muted-foreground">Estimated wages</span>
          <span className="font-medium tabular-nums">
            {formatMoney(artifact.estimatedCost.total, artifact.estimatedCost.currency)}
            {artifact.estimatedCost.unpriced > 0 && (
              <span className="font-normal text-muted-foreground">
                {' '}
                + {artifact.estimatedCost.unpriced} shift
                {artifact.estimatedCost.unpriced === 1 ? '' : 's'} without a rate
              </span>
            )}
          </span>
        </p>
      )}
      {artifact.people.length > 0 && (
        <div className="text-xs">
          <p className="mb-1 font-medium">Hours in this period</p>
          <ul className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            {artifact.people.map((person) => (
              <li key={person.userId} className="flex justify-between gap-2">
                <span className="truncate">{person.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {hours(person.newMinutes + person.existingMinutes)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Warnings items={artifact.warnings} />
      {result && (
        <div className="flex flex-col gap-1 text-xs">
          <p>
            {result.saved} shift{result.saved === 1 ? '' : 's'} added as unpublished changes. Staff
            see nothing until you publish the roster.
          </p>
          {result.skipped.length > 0 && (
            <Warnings
              items={result.skipped.map(
                (item) =>
                  `${formatCalendarDate(item.date)} ${item.startTime}${item.personName ? `, ${item.personName}` : ''}: ${item.reason}`,
              )}
            />
          )}
        </div>
      )}
      <Problem message={error} />
    </CardShell>
  );
}

function CommunicationCard({
  artifact,
  canSaveNotes,
}: {
  artifact: CommunicationDraftArtifact;
  canSaveNotes: boolean;
}) {
  const [subject, setSubject] = useState(artifact.subject ?? '');
  const [body, setBody] = useState(artifact.body);
  const [state, setState] = useState<CardState | 'saved'>('open');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const label =
    artifact.channel === 'email' ? 'Email' : artifact.channel === 'sms' ? 'Text message' : 'Note';

  const saveNote = () =>
    startTransition(async () => {
      setError(null);
      const result = await approveNoteAction({ contactId: artifact.contactId, body });
      if (result.ok) setState('saved');
      else setError(result.error.message);
    });

  const mailto =
    artifact.channel === 'email' && artifact.recipient.email
      ? `mailto:${encodeURIComponent(artifact.recipient.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      : null;
  const smsLink =
    artifact.channel === 'sms' && artifact.recipient.phone
      ? `sms:${artifact.recipient.phone.replace(/[^\d+]/g, '')}?body=${encodeURIComponent(body)}`
      : null;

  return (
    <CardShell
      title={`${label} for ${artifact.contactName}`}
      badge={state === 'saved' ? <Badge>Saved to timeline</Badge> : <DraftBadge />}
      footer={
        state === 'discarded' ? (
          <Discarded />
        ) : state === 'saved' ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/contacts/${artifact.contactId}`}>
              Open {artifact.contactName} <ExternalLink aria-hidden />
            </Link>
          </Button>
        ) : (
          <>
            {artifact.channel === 'note' && canSaveNotes && (
              <Button size="sm" onClick={saveNote} disabled={pending || !body.trim()}>
                {pending ? 'Saving…' : 'Approve & save note'}
              </Button>
            )}
            {mailto && (
              <Button asChild size="sm">
                <a href={mailto}>
                  <Mail aria-hidden /> Open in email app
                </a>
              </Button>
            )}
            {smsLink && (
              <Button asChild size="sm">
                <a href={smsLink}>
                  <MessageSquare aria-hidden /> Open in messages
                </a>
              </Button>
            )}
            <CopyButton
              text={artifact.channel === 'email' ? `Subject: ${subject}\n\n${body}` : body}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setState('discarded')}
              disabled={pending}
            >
              Discard
            </Button>
          </>
        )
      }
    >
      {artifact.channel === 'email' && (
        <Input
          aria-label="Subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          disabled={state !== 'open'}
        />
      )}
      <Textarea
        aria-label="Message"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={Math.min(14, Math.max(4, body.split('\n').length + 1))}
        disabled={state !== 'open'}
      />
      {artifact.channel !== 'note' && (
        <p className="text-xs text-muted-foreground">
          Nothing is sent from Meroidea. Check the draft, then send it from your own app.
          {!mailto && !smsLink && ' This contact has no address for this channel.'}
        </p>
      )}
      <Problem message={error} />
    </CardShell>
  );
}

const severityVariant = { high: 'destructive', medium: 'secondary', low: 'outline' } as const;

function documentText(artifact: DocumentSummaryArtifact): string {
  return [
    artifact.summary,
    artifact.keyDates.length
      ? `Key dates:\n${artifact.keyDates.map((item) => `- ${item.date ?? 'Undated'}: ${item.label}. ${item.description}`).join('\n')}`
      : '',
    artifact.actionItems.length
      ? `Action items:\n${artifact.actionItems.map((item) => `- ${item}`).join('\n')}`
      : '',
    artifact.risksOrFlags.length
      ? `Risks and flags:\n${artifact.risksOrFlags.map((item) => `- [${item.severity}] ${item.description}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function DocumentCard({ artifact }: { artifact: DocumentSummaryArtifact }) {
  const [state, setState] = useState<CardState>('open');
  return (
    <CardShell
      title={artifact.fileName}
      badge={<Badge variant="secondary">AI review</Badge>}
      footer={
        state === 'discarded' ? (
          <Discarded />
        ) : (
          <>
            <CopyButton text={documentText(artifact)} />
            <Button size="sm" variant="ghost" onClick={() => setState('discarded')}>
              Dismiss
            </Button>
          </>
        )
      }
    >
      <p className="text-xs whitespace-pre-line">{artifact.summary}</p>
      {artifact.keyDates.length > 0 && (
        <div className="text-xs">
          <p className="mb-1 font-medium">Key dates</p>
          <ul className="flex flex-col gap-1">
            {artifact.keyDates.map((item, index) => (
              <li key={index} className="flex gap-2">
                <CalendarClock
                  className="mt-0.5 size-3 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span>
                  <span className="font-medium">
                    {item.date ? formatCalendarDate(item.date) : 'Undated'}
                  </span>{' '}
                  · {item.label}
                  {item.description && (
                    <span className="block text-muted-foreground">{item.description}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {artifact.actionItems.length > 0 && (
        <div className="text-xs">
          <p className="mb-1 font-medium">Action items</p>
          <ul className="list-disc pl-4">
            {artifact.actionItems.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {artifact.risksOrFlags.length > 0 && (
        <div className="text-xs">
          <p className="mb-1 font-medium">Risks and flags</p>
          <ul className="flex flex-col gap-1">
            {artifact.risksOrFlags.map((item, index) => (
              <li key={index} className="flex items-start gap-2">
                <Badge variant={severityVariant[item.severity]}>{item.severity}</Badge>
                <span>{item.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Generated by AI from the file, which is not kept. Check anything important against the
        document; this is not legal advice.
      </p>
    </CardShell>
  );
}

function NextActionsCard({ artifact }: { artifact: NextActionsArtifact }) {
  if (artifact.actions.length === 0) return null;
  return (
    <CardShell title="Next steps" badge={<Badge variant="secondary">Suggestions</Badge>}>
      <ol className="flex flex-col gap-2 text-xs">
        {artifact.actions.map((action, index) => (
          <li key={index} className="flex flex-col gap-0.5 border-b pb-2 last:border-b-0 last:pb-0">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">
                {index + 1}. {action.title}
              </span>
              <Badge variant={severityVariant[action.priority]}>{action.priority}</Badge>
            </div>
            <p className="text-muted-foreground">{action.reason}</p>
            {action.href && (
              <Link href={action.href} className="text-primary underline-offset-4 hover:underline">
                Open {action.recordLabel ?? 'record'}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </CardShell>
  );
}

export function ArtifactCard({
  artifact,
  canSaveNotes,
}: {
  artifact: AssistantArtifact;
  canSaveNotes: boolean;
}) {
  switch (artifact.kind) {
    case 'invoice_draft':
      return <InvoiceCard artifact={artifact} />;
    case 'roster_preview':
      return <RosterCard artifact={artifact} />;
    case 'communication_draft':
      return <CommunicationCard artifact={artifact} canSaveNotes={canSaveNotes} />;
    case 'document_summary':
      return <DocumentCard artifact={artifact} />;
    case 'next_actions':
      return <NextActionsCard artifact={artifact} />;
  }
}
