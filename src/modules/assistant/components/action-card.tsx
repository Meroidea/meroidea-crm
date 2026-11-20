'use client';

import {
  CalendarClock,
  Check,
  FileText,
  ListTodo,
  Loader2,
  Mail,
  Pencil,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatMoney } from '@/lib/format';

import {
  invoiceTotals,
  type PendingActionView,
  type PendingEdit,
  type PendingStatus,
} from '../pending-schemas';

type ApiResult = { ok: true; data: PendingActionView } | { ok: false; error: { message: string } };

async function call(url: string, method: 'GET' | 'POST' | 'PATCH', body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return (await response.json().catch(() => ({
    ok: false,
    error: { message: 'Something went wrong. Please try again.' },
  }))) as ApiResult;
}

const STATUS: Record<
  PendingStatus,
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  pending: { label: 'Awaiting your approval', variant: 'secondary' },
  executing: { label: 'Applying…', variant: 'secondary' },
  approved: { label: 'Approved', variant: 'default' },
  rejected: { label: 'Cancelled', variant: 'outline' },
  failed: { label: 'Failed', variant: 'destructive' },
  expired: { label: 'Expired', variant: 'outline' },
};

const ICON = {
  invoice: FileText,
  roster: CalendarClock,
  staff_email: Mail,
  record_update: ListTodo,
};
const TITLE = {
  invoice: 'Draft invoice',
  roster: 'Roster shifts',
  staff_email: 'Email to staff',
  record_update: 'CRM update',
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-foreground">{children}</span>
    </div>
  );
}

/**
 * The confirmation card for one Meroidea AI proposal (ADR-064): exactly what will happen, with
 * Approve & Execute, Cancel, Edit and "ask the assistant to revise". Nothing on this card changes
 * the business until Approve, which the server checks again from scratch.
 */
export function ActionCard({
  initial,
  currency,
  onRevise,
}: {
  initial: PendingActionView;
  currency: string;
  onRevise: (text: string) => void;
}) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<'approve' | 'reject' | 'save' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const url = `/api/ai/actions/${initial.id}`;

  // A card from earlier in the conversation may have been decided since: show where it stands.
  useEffect(() => {
    let cancelled = false;
    void call(url, 'GET').then((result) => {
      if (!cancelled && result.ok) setView(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const run = async (kind: 'approve' | 'reject') => {
    setBusy(kind);
    setMessage(null);
    const result = await call(`${url}/${kind}`, 'POST');
    if (result.ok) setView(result.data);
    else {
      setMessage(result.error.message);
      const fresh = await call(url, 'GET');
      if (fresh.ok) setView(fresh.data);
    }
    setBusy(null);
  };

  const save = async (edit: PendingEdit) => {
    setBusy('save');
    setMessage(null);
    const result = await call(url, 'PATCH', edit);
    if (result.ok) {
      setView(result.data);
      setEditing(false);
    } else setMessage(result.error.message);
    setBusy(null);
  };

  const Icon = ICON[view.kind];
  const status = STATUS[view.status];
  const pending = view.status === 'pending';
  const editable = view.kind !== 'record_update' || view.payload.change === 'create_task';

  return (
    <div
      className="rounded-xl border bg-card p-3 shadow-xs"
      aria-label={`${TITLE[view.kind]} proposal`}
    >
      <div className="mb-2 flex items-start gap-2">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{TITLE[view.kind]}</p>
          <p className="text-xs text-muted-foreground">{view.summary}</p>
        </div>
        <Badge variant={status.variant} className="shrink-0">
          {status.label}
        </Badge>
      </div>

      {editing ? (
        <EditForm
          view={view}
          busy={busy === 'save'}
          onCancel={() => setEditing(false)}
          onSave={save}
        />
      ) : (
        <Preview view={view} currency={currency} />
      )}

      {(message ?? (pending ? view.error : null)) && (
        <p
          role="alert"
          className="mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive-text"
        >
          {message ?? view.error}
        </p>
      )}
      {view.status === 'failed' && view.error && !message && (
        <p className="mt-2 text-xs text-destructive-text">{view.error}</p>
      )}
      {view.status === 'approved' && view.result && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-foreground">
          <Check className="size-3.5 text-primary" aria-hidden />
          {view.result.note}
          {view.result.href && (
            <Link
              href={view.result.href}
              className="text-primary underline-offset-4 hover:underline"
            >
              Open
            </Link>
          )}
        </p>
      )}

      {pending && !editing && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={() => void run('approve')} disabled={busy !== null}>
            {busy === 'approve' ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Check aria-hidden />
            )}
            Approve &amp; Execute
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void run('reject')}
            disabled={busy !== null}
          >
            <X aria-hidden />
            Cancel
          </Button>
          {editable && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(true)}
              disabled={busy !== null}
            >
              <Pencil aria-hidden />
              Edit
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRevise(`Revise proposal ${view.id}: `)}
            disabled={busy !== null}
          >
            <Sparkles aria-hidden />
            Ask to revise
          </Button>
        </div>
      )}
    </div>
  );
}

function Preview({ view, currency }: { view: PendingActionView; currency: string }) {
  switch (view.kind) {
    case 'invoice': {
      const { invoice } = view.payload;
      const totals = invoiceTotals(invoice);
      return (
        <div className="space-y-2">
          <Field label="Customer">
            {invoice.customerName}
            {invoice.customerEmail && (
              <span className="text-muted-foreground"> · {invoice.customerEmail}</span>
            )}
          </Field>
          <Field label="Dates">
            Issued {invoice.issueDate} · due {invoice.dueDate}
          </Field>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/60 text-left">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Item</th>
                  <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                  <th className="px-2 py-1.5 text-right font-medium">Price</th>
                  <th className="px-2 py-1.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {invoice.lines.map((line, index) => (
                  <tr key={index} className="border-t">
                    <td className="px-2 py-1.5">{line.description}</td>
                    <td className="px-2 py-1.5 text-right">{line.quantity}</td>
                    <td className="px-2 py-1.5 text-right">
                      {formatMoney(line.unitPrice, currency)}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {formatMoney(totals.lines[index], currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="tabular-nums">
                <tr className="border-t">
                  <td colSpan={3} className="px-2 py-1 text-right text-muted-foreground">
                    Subtotal
                  </td>
                  <td className="px-2 py-1 text-right">{formatMoney(totals.subtotal, currency)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className="px-2 py-1 text-right text-muted-foreground">
                    Tax ({invoice.taxRate}%)
                  </td>
                  <td className="px-2 py-1 text-right">{formatMoney(totals.tax, currency)}</td>
                </tr>
                <tr className="font-semibold">
                  <td colSpan={3} className="px-2 py-1 text-right">
                    Total
                  </td>
                  <td className="px-2 py-1 text-right text-primary">
                    {formatMoney(totals.total, currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {invoice.notes && <Field label="Notes">{invoice.notes}</Field>}
          <p className="text-xs text-muted-foreground">
            Saved as a draft. It is not sent to the customer.
          </p>
        </div>
      );
    }
    case 'roster':
      return (
        <div className="space-y-2">
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/60 text-left">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Person</th>
                  <th className="px-2 py-1.5 font-medium">Day</th>
                  <th className="px-2 py-1.5 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {view.payload.shifts.map((shift) => (
                  <tr key={`${shift.userId}|${shift.date}`} className="border-t">
                    <td className="px-2 py-1.5">{shift.personName}</td>
                    <td className="px-2 py-1.5">{shift.date}</td>
                    <td className="px-2 py-1.5">
                      {shift.startTime}–{shift.endTime}
                      {shift.note && (
                        <span className="block text-muted-foreground">{shift.note}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Breaks follow your break rules. Shifts stay unpublished until you publish the roster.
          </p>
        </div>
      );
    case 'staff_email':
      return (
        <div className="space-y-2">
          <Field label={`To (${view.payload.recipients.length})`}>
            {view.payload.recipients.map((person) => person.name).join(', ')}
          </Field>
          <Field label="Subject">{view.payload.subject}</Field>
          <div className="max-h-48 overflow-y-auto rounded-md border bg-background p-2 text-xs whitespace-pre-wrap">
            {view.payload.body}
          </div>
          <p className="text-xs text-muted-foreground">
            Each person gets their own copy with a greeting; replies come to you.
          </p>
        </div>
      );
    case 'record_update': {
      const change = view.payload;
      return change.change === 'move_stage' ? (
        <div className="space-y-1.5">
          <Field label="Record">{change.opportunityName}</Field>
          <Field label="Stage">
            {change.fromStageName} → <strong>{change.stageName}</strong>
          </Field>
          {change.lostReasonName && <Field label="Lost reason">{change.lostReasonName}</Field>}
        </div>
      ) : (
        <div className="space-y-1.5">
          <Field label="Task">{change.title}</Field>
          <Field label="Due">{change.dueDate ?? 'No date'}</Field>
          <Field label="Priority">{change.priority}</Field>
          <Field label="For">{change.assigneeName ?? 'You'}</Field>
          {change.contactName && <Field label="Contact">{change.contactName}</Field>}
          {change.opportunityName && <Field label="Linked to">{change.opportunityName}</Field>}
        </div>
      );
    }
  }
}

function EditForm({
  view,
  busy,
  onCancel,
  onSave,
}: {
  view: PendingActionView;
  busy: boolean;
  onCancel: () => void;
  onSave: (edit: PendingEdit) => void;
}) {
  const actions = (edit: () => PendingEdit) => (
    <div className="flex gap-1.5 pt-1">
      <Button size="sm" onClick={() => onSave(edit())} disabled={busy}>
        {busy && <Loader2 className="animate-spin" aria-hidden />}
        Save changes
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
        Back
      </Button>
    </div>
  );

  if (view.kind === 'staff_email') return <EmailEdit view={view} actions={actions} />;
  if (view.kind === 'invoice') return <InvoiceEdit view={view} actions={actions} />;
  if (view.kind === 'roster') return <RosterEdit view={view} actions={actions} />;
  if (view.payload.change === 'create_task') return <TaskEdit view={view} actions={actions} />;
  return null;
}

type EditProps<K extends PendingActionView['kind']> = {
  view: Extract<PendingActionView, { kind: K }>;
  actions: (edit: () => PendingEdit) => ReactNode;
};

function EmailEdit({ view, actions }: EditProps<'staff_email'>) {
  const [subject, setSubject] = useState(view.payload.subject);
  const [body, setBody] = useState(view.payload.body);
  const [keep, setKeep] = useState(view.payload.recipients.map((r) => r.userId));
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap gap-1">
        {view.payload.recipients
          .filter((person) => keep.includes(person.userId))
          .map((person) => (
            <span
              key={person.userId}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5"
            >
              {person.name}
              <button
                type="button"
                aria-label={`Remove ${person.name}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setKeep((ids) => ids.filter((id) => id !== person.userId))}
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
      </div>
      <Input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <Textarea
        aria-label="Message"
        rows={8}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {actions(() => ({ kind: 'staff_email', subject, body, userIds: keep }))}
    </div>
  );
}

function InvoiceEdit({ view, actions }: EditProps<'invoice'>) {
  const [invoice, setInvoice] = useState(view.payload.invoice);
  const setLine = (index: number, field: 'description' | 'quantity' | 'unitPrice', value: string) =>
    setInvoice((current) => ({
      ...current,
      lines: current.lines.map((line, i) => (i === index ? { ...line, [field]: value } : line)),
    }));
  return (
    <div className="space-y-2 text-xs">
      <Input
        aria-label="Customer"
        value={invoice.customerName}
        onChange={(e) => setInvoice({ ...invoice, customerName: e.target.value })}
      />
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-muted-foreground">Due date</span>
          <Input
            type="date"
            value={invoice.dueDate}
            onChange={(e) => setInvoice({ ...invoice, dueDate: e.target.value })}
          />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">Tax %</span>
          <Input
            value={invoice.taxRate}
            onChange={(e) => setInvoice({ ...invoice, taxRate: e.target.value })}
          />
        </label>
      </div>
      {invoice.lines.map((line, index) => (
        <div key={index} className="grid grid-cols-[1fr_3.5rem_5rem_auto] gap-1">
          <Input
            aria-label="Item"
            value={line.description}
            onChange={(e) => setLine(index, 'description', e.target.value)}
          />
          <Input
            aria-label="Quantity"
            value={line.quantity}
            onChange={(e) => setLine(index, 'quantity', e.target.value)}
          />
          <Input
            aria-label="Unit price"
            value={line.unitPrice}
            onChange={(e) => setLine(index, 'unitPrice', e.target.value)}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Remove line"
            disabled={invoice.lines.length === 1}
            onClick={() =>
              setInvoice({ ...invoice, lines: invoice.lines.filter((_, i) => i !== index) })
            }
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}
      <Textarea
        aria-label="Notes"
        rows={2}
        placeholder="Notes"
        value={invoice.notes ?? ''}
        onChange={(e) => setInvoice({ ...invoice, notes: e.target.value })}
      />
      {actions(() => ({ kind: 'invoice', invoice }))}
    </div>
  );
}

function RosterEdit({ view, actions }: EditProps<'roster'>) {
  const [shifts, setShifts] = useState(view.payload.shifts);
  const set = (index: number, field: 'startTime' | 'endTime', value: string) =>
    setShifts((current) => current.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  return (
    <div className="space-y-1.5 text-xs">
      {shifts.map((shift, index) => (
        <div
          key={`${shift.userId}|${shift.date}`}
          className="grid grid-cols-[1fr_5.5rem_5.5rem_auto] items-center gap-1"
        >
          <span className="truncate">
            {shift.personName} · {shift.date}
          </span>
          <Input
            type="time"
            aria-label="Start"
            value={shift.startTime}
            onChange={(e) => set(index, 'startTime', e.target.value)}
          />
          <Input
            type="time"
            aria-label="End"
            value={shift.endTime}
            onChange={(e) => set(index, 'endTime', e.target.value)}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Remove shift"
            disabled={shifts.length === 1}
            onClick={() => setShifts(shifts.filter((_, i) => i !== index))}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}
      {actions(() => ({
        kind: 'roster',
        shifts: shifts.map((shift) => ({
          userId: shift.userId,
          date: shift.date,
          startTime: shift.startTime,
          endTime: shift.endTime,
          note: shift.note,
        })),
      }))}
    </div>
  );
}

function TaskEdit({ view, actions }: EditProps<'record_update'>) {
  const task = view.payload.change === 'create_task' ? view.payload : null;
  const [title, setTitle] = useState(task?.title ?? '');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>(task?.priority ?? 'normal');
  return (
    <div className="space-y-2 text-xs">
      <Input aria-label="Task" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="date"
          aria-label="Due date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <select
          aria-label="Priority"
          className="h-8 rounded-md border bg-background px-2"
          value={priority}
          onChange={(e) => setPriority(e.target.value as typeof priority)}
        >
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>
      </div>
      {actions(() => ({ kind: 'record_update', title, dueDate: dueDate || null, priority }))}
    </div>
  );
}
