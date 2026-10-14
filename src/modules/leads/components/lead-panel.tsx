'use client';

import { ArrowRightLeft, Check, CircleAlert, Clock, Send, Undo2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Field } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { zonedDateTimeToInstant } from '@/lib/dates';
import { stageColorVar } from '@/lib/stage-color';
import {
  acceptHandoverAction,
  accountMatchesAction,
  convertLeadAction,
  handoverLeadAction,
  rejectHandoverAction,
  setLeadStatusAction,
} from '@/modules/leads/actions';

type Option = { value: string; label: string };
type StatusOption = { id: string; name: string; kind: string; requiresReason: boolean };

export type LeadPanelProps = {
  contactId: string;
  contactName: string;
  timezone: string;
  lead: {
    type: 'b2b' | 'b2c' | null;
    statusId: string;
    statusName: string;
    statusKind: string;
    statusColor: string | null;
    reasonName: string | null;
    reasonNote: string | null;
    originatorName: string | null;
    handoverToName: string | null;
    handoverSummary: string | null;
    rejectedReasonName: string | null;
    rejectedNote: string | null;
    companyName: string | null;
    companyWebsite: string | null;
    interest: string | null;
  };
  /** Pre-formatted in the business's timezone on the server. */
  when: {
    statusChanged: string | null;
    firstContacted: string | null;
    handoverAt: string | null;
    handoverDue: string | null;
    meeting: string | null;
    rejectedAt: string | null;
    converted: string | null;
  };
  overdue: { firstContact: boolean; acceptance: boolean };
  completeness: number;
  missingForHandover: string[];
  statuses: StatusOption[];
  disqualifyReasons: Option[];
  rejectReasons: Option[];
  people: Option[];
  pipelines: Option[];
  contactRoles: string[];
  /** handover: B2B or a B2C qualification step; approval: B2C needing approval; direct: B2C convert. */
  path: 'handover' | 'approval' | 'direct';
  canEdit: boolean;
  canDecide: boolean;
  canConvert: boolean;
  labels: { organization: string; opportunity: string };
};

function ConvertFields({
  props,
  values,
  set,
}: {
  props: LeadPanelProps;
  values: ConvertValues;
  set: (patch: Partial<ConvertValues>) => void;
}) {
  const [matches, setMatches] = useState<{ id: string; name: string; why: string }[]>([]);
  const isBusiness = props.lead.type === 'b2b';

  useEffect(() => {
    if (!isBusiness) return;
    void accountMatchesAction({ contactId: props.contactId }).then((result) => {
      if (!result.ok) return;
      setMatches(result.data);
      const first = result.data[0];
      if (first) set({ organizationMode: 'existing', organizationId: first.id });
    });
    // Load once when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.contactId, isBusiness]);

  return (
    <>
      <Field name="opp-name" label={`${props.labels.opportunity} name`} required>
        <Input
          id="opp-name"
          value={values.opportunityName}
          onChange={(e) => set({ opportunityName: e.target.value })}
        />
      </Field>
      {props.pipelines.length > 1 && (
        <Field name="opp-pipeline" label="Pipeline">
          <NativeSelect
            id="opp-pipeline"
            value={values.pipelineId}
            onChange={(e) => set({ pipelineId: e.target.value })}
          >
            <option value="">The usual one for this lead</option>
            {props.pipelines.map((pipeline) => (
              <option key={pipeline.value} value={pipeline.value}>
                {pipeline.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      {isBusiness && (
        <fieldset className="flex flex-col gap-2 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">{props.labels.organization}</legend>
          {matches.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Found {matches.length === 1 ? 'a likely match' : 'likely matches'} already in your
              workspace.
            </p>
          )}
          {matches.map((match) => (
            <label key={match.id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="org-choice"
                className="accent-primary"
                checked={
                  values.organizationMode === 'existing' && values.organizationId === match.id
                }
                onChange={() => set({ organizationMode: 'existing', organizationId: match.id })}
              />
              Link to {match.name}
              <span className="text-xs text-muted-foreground">
                (same {match.why === 'domain' ? 'website' : 'name'})
              </span>
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="org-choice"
              className="accent-primary"
              checked={values.organizationMode === 'new'}
              onChange={() => set({ organizationMode: 'new' })}
            />
            Create a new {props.labels.organization.toLowerCase()}
          </label>
          {values.organizationMode === 'new' && (
            <div className="grid gap-2 pl-6">
              <Input
                aria-label="Name"
                value={values.organizationName}
                onChange={(e) => set({ organizationName: e.target.value })}
              />
              <Input
                aria-label="Website"
                placeholder="example.com"
                value={values.organizationWebsite}
                onChange={(e) => set({ organizationWebsite: e.target.value })}
              />
              {matches.length > 0 && (
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={values.confirmNew}
                    onChange={(e) => set({ confirmNew: e.target.checked })}
                  />
                  Yes, it is a different company
                </label>
              )}
            </div>
          )}
          <Field name="contact-role" label="Their role there">
            <NativeSelect
              id="contact-role"
              value={values.contactRole}
              onChange={(e) => set({ contactRole: e.target.value })}
            >
              {props.contactRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </fieldset>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field name="opp-amount" label="Expected value">
          <Input
            id="opp-amount"
            inputMode="decimal"
            value={values.amount}
            onChange={(e) => set({ amount: e.target.value })}
          />
        </Field>
        <Field name="opp-close" label="Expected close">
          <Input
            id="opp-close"
            type="date"
            value={values.expectedCloseDate}
            onChange={(e) => set({ expectedCloseDate: e.target.value })}
          />
        </Field>
      </div>
      <Field name="opp-product" label="Product or service">
        <Input
          id="opp-product"
          value={values.product}
          onChange={(e) => set({ product: e.target.value })}
        />
      </Field>
      <Field name="opp-next" label="Next step">
        <Input
          id="opp-next"
          value={values.nextStep}
          onChange={(e) => set({ nextStep: e.target.value })}
        />
      </Field>
    </>
  );
}

type ConvertValues = {
  opportunityName: string;
  pipelineId: string;
  organizationMode: 'none' | 'existing' | 'new';
  organizationId: string;
  organizationName: string;
  organizationWebsite: string;
  confirmNew: boolean;
  contactRole: string;
  amount: string;
  expectedCloseDate: string;
  product: string;
  nextStep: string;
  ownerUserId: string;
};

function convertPayload(contactId: string, isBusiness: boolean, values: ConvertValues) {
  return {
    contactId,
    opportunityName: values.opportunityName,
    pipelineId: values.pipelineId,
    organization: !isBusiness
      ? { mode: 'none' as const }
      : values.organizationMode === 'existing'
        ? { mode: 'existing' as const, id: values.organizationId }
        : {
            mode: 'new' as const,
            name: values.organizationName,
            website: values.organizationWebsite,
            confirmNew: values.confirmNew,
          },
    contactRole: values.contactRole,
    amount: values.amount,
    expectedCloseDate: values.expectedCloseDate,
    product: values.product,
    nextStep: values.nextStep,
  };
}

export function LeadPanel(props: LeadPanelProps) {
  const router = useRouter();
  const { lead } = props;
  const { run, error, isPending, setError } = useActionRunner();
  const [dialog, setDialog] = useState<
    null | 'status' | 'handover' | 'accept' | 'reject' | 'convert'
  >(null);

  const [statusId, setStatusId] = useState(lead.statusId);
  const [reasonId, setReasonId] = useState('');
  const [note, setNote] = useState('');
  const [toUserId, setToUserId] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingTime, setMeetingTime] = useState('');
  const [summary, setSummary] = useState('');
  const defaultName =
    [lead.companyName, lead.interest].filter(Boolean).join(' – ') || props.contactName;
  const [convert, setConvert] = useState<ConvertValues>({
    opportunityName: defaultName,
    pipelineId: '',
    organizationMode: lead.type === 'b2b' ? 'new' : 'none',
    organizationId: '',
    organizationName: lead.companyName ?? '',
    organizationWebsite: lead.companyWebsite ?? '',
    confirmNew: false,
    contactRole: props.contactRoles[0] ?? 'Contact',
    amount: '',
    expectedCloseDate: '',
    product: lead.interest ?? '',
    nextStep: '',
    ownerUserId: '',
  });
  const patchConvert = (patch: Partial<ConvertValues>) =>
    setConvert((current) => ({ ...current, ...patch }));

  const chosen = props.statuses.find((status) => status.id === statusId);
  const open = (name: typeof dialog) => {
    setError(null);
    setDialog(name);
  };
  const close = () => setDialog(null);
  const kind = lead.statusKind;
  const workable = ['new', 'working', 'returned'].includes(kind);
  const isBusiness = lead.type === 'b2b';
  const handoverWord = props.path === 'approval' ? 'Submit for approval' : 'Hand over';

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          Lead
          {lead.type && <Badge variant="outline">{lead.type === 'b2b' ? 'B2B' : 'B2C'}</Badge>}
        </CardTitle>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-medium"
          style={{ borderColor: stageColorVar(lead.statusColor) }}
        >
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ background: stageColorVar(lead.statusColor) }}
          />
          {lead.statusName}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Data completeness</span>
            <span className="font-medium text-foreground tabular-nums">{props.completeness}%</span>
          </div>
          <div
            className="mt-1 h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Data completeness"
            aria-valuenow={props.completeness}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${props.completeness}%` }}
            />
          </div>
        </div>

        <dl className="grid gap-2 text-sm">
          {props.when.statusChanged && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Status since</dt>
              <dd>{props.when.statusChanged}</dd>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">First contact</dt>
            <dd
              className={
                props.overdue.firstContact ? 'font-medium text-destructive-text' : undefined
              }
            >
              {props.when.firstContacted ?? (props.overdue.firstContact ? 'Overdue' : 'Not yet')}
            </dd>
          </div>
          {lead.originatorName && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Originated by</dt>
              <dd>{lead.originatorName}</dd>
            </div>
          )}
          {kind === 'closed' && lead.reasonName && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Reason</dt>
              <dd>{lead.reasonName}</dd>
            </div>
          )}
          {props.when.converted && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Converted</dt>
              <dd>{props.when.converted}</dd>
            </div>
          )}
        </dl>

        {kind === 'pending_acceptance' && (
          <div className="flex flex-col gap-2 rounded-lg border border-warning-border bg-warning p-3 text-sm text-warning-text">
            <p className="flex items-center gap-2 font-medium">
              <Clock aria-hidden className="size-4" />
              Waiting for {lead.handoverToName ?? 'someone'} to{' '}
              {props.path === 'approval' ? 'approve' : 'accept'}
            </p>
            {props.when.handoverDue && (
              <p className={props.overdue.acceptance ? 'font-medium' : undefined}>
                {props.overdue.acceptance ? 'Overdue since' : 'Due by'} {props.when.handoverDue}
              </p>
            )}
            {props.when.meeting && <p>Meeting agreed: {props.when.meeting}</p>}
            {lead.handoverSummary && (
              <p className="whitespace-pre-wrap">“{lead.handoverSummary}”</p>
            )}
          </div>
        )}
        {kind === 'returned' && lead.rejectedReasonName && (
          <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <Undo2 aria-hidden className="size-4" /> Returned: {lead.rejectedReasonName}
            </p>
            {lead.rejectedNote && <p className="text-muted-foreground">{lead.rejectedNote}</p>}
            {props.when.rejectedAt && (
              <p className="text-xs text-muted-foreground">{props.when.rejectedAt}</p>
            )}
          </div>
        )}

        {workable && props.missingForHandover.length > 0 && props.path === 'handover' && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            To hand over, fill in: {props.missingForHandover.join(', ')}.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {props.canEdit && workable && (
            <Button size="sm" variant="outline" onClick={() => open('status')}>
              Change status
            </Button>
          )}
          {props.canEdit && workable && props.path !== 'direct' && (
            <Button size="sm" onClick={() => open('handover')}>
              <Send aria-hidden /> {handoverWord}
            </Button>
          )}
          {props.canEdit && props.canConvert && workable && props.path === 'direct' && (
            <Button size="sm" onClick={() => open('convert')}>
              <ArrowRightLeft aria-hidden /> Convert
            </Button>
          )}
          {props.canDecide && kind === 'pending_acceptance' && (
            <>
              <Button size="sm" onClick={() => open('accept')} disabled={!props.canConvert}>
                <Check aria-hidden /> {props.path === 'approval' ? 'Approve' : 'Accept'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => open('reject')}>
                <X aria-hidden /> {props.path === 'approval' ? 'Send back' : 'Reject'}
              </Button>
            </>
          )}
        </div>
      </CardContent>

      <AlertDialog open={dialog === 'status'} onOpenChange={(next) => !next && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change status</AlertDialogTitle>
            <AlertDialogDescription>Where is this lead now?</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-3">
            <Field name="lead-status" label="Status">
              <NativeSelect
                id="lead-status"
                value={statusId}
                onChange={(e) => setStatusId(e.target.value)}
              >
                {props.statuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {chosen?.kind === 'closed' && (
              <Field name="lead-reason" label="Reason" required={chosen.requiresReason}>
                <NativeSelect
                  id="lead-reason"
                  value={reasonId}
                  onChange={(e) => setReasonId(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {props.disqualifyReasons.map((reason) => (
                    <option key={reason.value} value={reason.value}>
                      {reason.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field name="lead-note" label="Note (optional)">
              <Textarea
                id="lead-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <ErrorNote error={error} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <Button
              disabled={isPending || statusId === lead.statusId}
              onClick={() =>
                run(
                  () =>
                    setLeadStatusAction({ contactId: props.contactId, statusId, reasonId, note }),
                  close,
                )
              }
            >
              {isPending ? 'Saving…' : 'Save'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dialog === 'reject'} onOpenChange={(next) => !next && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {props.path === 'approval' ? 'Send back' : 'Reject handover'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              It goes back to {lead.originatorName ?? 'whoever handed it over'} as Returned, with
              your reason.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-3">
            <Field name="reject-reason" label="Reason" required>
              <NativeSelect
                id="reject-reason"
                value={reasonId}
                onChange={(e) => setReasonId(e.target.value)}
              >
                <option value="">Choose…</option>
                {props.rejectReasons.map((reason) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field name="reject-note" label="Comment (optional)">
              <Textarea
                id="reject-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <ErrorNote error={error} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <Button
              disabled={isPending || !reasonId}
              onClick={() =>
                run(
                  () => rejectHandoverAction({ contactId: props.contactId, reasonId, note }),
                  () => {
                    close();
                    router.refresh();
                  },
                )
              }
            >
              {isPending ? 'Saving…' : 'Return it'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={dialog === 'handover'} onOpenChange={(next) => !next && close()}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{handoverWord}</SheetTitle>
            <SheetDescription>
              {props.path === 'approval'
                ? 'Ask someone to approve converting this lead.'
                : 'Pass this lead to a sales rep. They see its whole history and accept or reject it.'}
            </SheetDescription>
          </SheetHeader>
          <form
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={(event) => {
              event.preventDefault();
              const meetingAt =
                meetingDate && meetingTime
                  ? zonedDateTimeToInstant(props.timezone, meetingDate, meetingTime).toISOString()
                  : '';
              run(
                () =>
                  handoverLeadAction({ contactId: props.contactId, toUserId, meetingAt, summary }),
                close,
              );
            }}
          >
            <Field name="handover-to" label={props.path === 'approval' ? 'Approver' : 'Sales rep'}>
              <NativeSelect
                id="handover-to"
                value={toUserId}
                onChange={(e) => setToUserId(e.target.value)}
              >
                {props.path === 'handover' && (
                  <option value="">Use the handover routing rules</option>
                )}
                {props.path === 'approval' && <option value="">Choose…</option>}
                {props.people.map((person) => (
                  <option key={person.value} value={person.value}>
                    {person.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {props.path === 'handover' && (
              <div className="grid grid-cols-2 gap-3">
                <Field name="meeting-date" label="Meeting date (if agreed)">
                  <Input
                    id="meeting-date"
                    type="date"
                    value={meetingDate}
                    onChange={(e) => setMeetingDate(e.target.value)}
                  />
                </Field>
                <Field name="meeting-time" label="Time">
                  <Input
                    id="meeting-time"
                    type="time"
                    value={meetingTime}
                    onChange={(e) => setMeetingTime(e.target.value)}
                  />
                </Field>
              </div>
            )}
            <Field
              name="handover-summary"
              label="Handover summary"
              required
              hint="Their need, budget, timing, and who decides."
            >
              <Textarea
                id="handover-summary"
                rows={5}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </Field>
            <ErrorNote error={error} />
            <SheetFooter className="mt-auto flex-row justify-end px-0">
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Sending…' : handoverWord}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet
        open={dialog === 'accept' || dialog === 'convert'}
        onOpenChange={(next) => !next && close()}
      >
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>
              {dialog === 'accept'
                ? props.path === 'approval'
                  ? 'Approve and convert'
                  : 'Accept lead'
                : 'Convert lead'}
            </SheetTitle>
            <SheetDescription>
              Creates the {props.labels.opportunity.toLowerCase()}
              {isBusiness ? ` under the ${props.labels.organization.toLowerCase()}` : ''}. Its
              history stays with the person.
            </SheetDescription>
          </SheetHeader>
          <form
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={(event) => {
              event.preventDefault();
              const payload = convertPayload(props.contactId, isBusiness, convert);
              if (dialog === 'accept') {
                run(
                  () => acceptHandoverAction(payload),
                  (data) => {
                    close();
                    router.push(`/opportunities/${data.opportunityId}`);
                  },
                );
              } else {
                run(
                  () => convertLeadAction({ ...payload, ownerUserId: convert.ownerUserId }),
                  (data) => {
                    close();
                    router.push(`/opportunities/${data.opportunityId}`);
                  },
                );
              }
            }}
          >
            <ConvertFields props={props} values={convert} set={patchConvert} />
            {dialog === 'convert' && props.people.length > 1 && (
              <Field name="convert-owner" label="Owner">
                <NativeSelect
                  id="convert-owner"
                  value={convert.ownerUserId}
                  onChange={(e) => patchConvert({ ownerUserId: e.target.value })}
                >
                  <option value="">The lead’s owner</option>
                  {props.people.map((person) => (
                    <option key={person.value} value={person.value}>
                      {person.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <ErrorNote error={error} />
            <SheetFooter className="mt-auto flex-row justify-end px-0">
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending
                  ? 'Saving…'
                  : dialog === 'accept'
                    ? props.path === 'approval'
                      ? 'Approve'
                      : 'Accept'
                    : 'Convert'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
