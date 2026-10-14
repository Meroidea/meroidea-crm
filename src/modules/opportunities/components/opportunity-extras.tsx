'use client';

import { CheckCircle2, Clock, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  addOpportunityContactAction,
  decideApprovalAction,
  removeOpportunityContactAction,
  setChecklistItemAction,
  withdrawApprovalAction,
} from '@/modules/opportunities/actions';

/** The current stage's checklist: what to finish before moving forward (docs/leads.md §4.8). */
export function StageChecklist({
  opportunityId,
  stageId,
  items,
  done,
  canEdit,
}: {
  opportunityId: string;
  stageId: string;
  items: { id: string; label: string }[];
  done: string[];
  canEdit: boolean;
}) {
  const { run, error, isPending } = useActionRunner();
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.id}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                disabled={!canEdit || isPending}
                checked={done.includes(item.id)}
                onChange={(event) =>
                  run(() =>
                    setChecklistItemAction({
                      id: opportunityId,
                      stageId,
                      itemId: item.id,
                      done: event.target.checked,
                    }),
                  )
                }
              />
              <span
                className={
                  done.includes(item.id) ? 'text-muted-foreground line-through' : undefined
                }
              >
                {item.label}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {done.filter((id) => items.some((item) => item.id === id)).length} of {items.length} done ·
        needed before moving forward
      </p>
      <ErrorNote error={error} />
    </div>
  );
}

export function ApprovalBanner({
  approval,
  canDecide,
  canWithdraw,
}: {
  approval: {
    id: string;
    stageName: string;
    requestedByName: string | null;
    when: string;
    note: string | null;
  };
  canDecide: boolean;
  canWithdraw: boolean;
}) {
  const { run, error, isPending } = useActionRunner();
  const [note, setNote] = useState('');
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-warning-border bg-warning p-4 text-sm text-warning-text">
      <p className="flex items-center gap-2 font-medium">
        <Clock aria-hidden className="size-4" /> Waiting for approval to move to{' '}
        {approval.stageName}
      </p>
      <p>
        Asked by {approval.requestedByName ?? 'a former member'} on {approval.when}
        {approval.note ? ` — “${approval.note}”` : ''}
      </p>
      {canDecide && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Note (optional)"
            placeholder="Note (optional)"
            className="h-8 max-w-xs bg-background"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <Button
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(() => decideApprovalAction({ approvalId: approval.id, approve: true, note }))
            }
          >
            <CheckCircle2 aria-hidden /> Approve and move
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              run(() => decideApprovalAction({ approvalId: approval.id, approve: false, note }))
            }
          >
            Decline
          </Button>
        </div>
      )}
      {!canDecide && canWithdraw && (
        <Button
          size="sm"
          variant="outline"
          className="w-fit"
          disabled={isPending}
          onClick={() => run(() => withdrawApprovalAction({ approvalId: approval.id }))}
        >
          Withdraw request
        </Button>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

export function OpportunityPeople({
  opportunityId,
  people,
  options,
  roles,
  canEdit,
}: {
  opportunityId: string;
  people: { linkId: string; contactId: string; name: string; role: string }[];
  options: { value: string; label: string }[];
  roles: string[];
  canEdit: boolean;
}) {
  const { run, error, isPending } = useActionRunner();
  const [adding, setAdding] = useState(false);
  const [contactId, setContactId] = useState('');
  const [role, setRole] = useState(roles[0] ?? 'Other');
  return (
    <div className="flex flex-col gap-3">
      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground">Only the main contact so far.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {people.map((person) => (
            <li key={person.linkId} className="flex items-center justify-between gap-2 py-2">
              <Link href={`/contacts/${person.contactId}`} className="min-w-0 hover:text-primary">
                <span className="block truncate text-sm font-medium">{person.name}</span>
                <span className="text-xs text-muted-foreground">{person.role}</span>
              </Link>
              {canEdit && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${person.name}`}
                  disabled={isPending}
                  onClick={() =>
                    run(() =>
                      removeOpportunityContactAction({ id: opportunityId, linkId: person.linkId }),
                    )
                  }
                >
                  <X aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit &&
        (adding ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              run(
                () => addOpportunityContactAction({ id: opportunityId, contactId, role }),
                () => {
                  setAdding(false);
                  setContactId('');
                },
              );
            }}
          >
            <NativeSelect
              aria-label="Person"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
            >
              <option value="">Choose a person…</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </NativeSelect>
            <ErrorNote error={error} />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isPending || !contactId}>
                Add
              </Button>
            </div>
          </form>
        ) : (
          <Button size="sm" variant="outline" className="w-fit" onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Add a person
          </Button>
        ))}
      {!adding && <ErrorNote error={error} />}
    </div>
  );
}
