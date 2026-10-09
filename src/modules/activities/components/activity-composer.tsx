'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { logActivityAction } from '@/modules/activities/actions';
import {
  INTERACTION_LABELS,
  INTERACTION_TYPES,
  type InteractionType,
} from '@/modules/activities/schemas';

const PLACEHOLDER: Record<InteractionType, string> = {
  note: 'Write a note for the team…',
  call: 'What was discussed? What happens next?',
  email: 'Summary of the email…',
  meeting: 'Who was there and what was agreed?',
  message: 'Summary of the WhatsApp/SMS conversation…',
};

/** The composer at the top of a record's timeline: log what happened, in one step. */
export function ActivityComposer({
  contactId,
  opportunityId,
}: {
  contactId?: string;
  opportunityId?: string;
}) {
  const router = useRouter();
  const [type, setType] = useState<InteractionType>('note');
  const [body, setBody] = useState('');
  const [outcome, setOutcome] = useState('connected');
  const [direction, setDirection] = useState<'outbound' | 'inbound'>('outbound');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await logActivityAction({
        type,
        body,
        contactId,
        opportunityId,
        direction: type === 'note' ? undefined : direction,
        outcome: type === 'call' ? outcome : undefined,
      });
      if (!result.ok) {
        setError(result.error.fieldErrors?.body?.[0] ?? result.error.message);
        return;
      }
      setBody('');
      router.refresh();
    });

  return (
    <div className="rounded-xl border bg-card p-3">
      <div role="tablist" aria-label="Activity type" className="flex flex-wrap gap-1">
        {INTERACTION_TYPES.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={type === option}
            onClick={() => setType(option)}
            className={cn(
              'rounded-md px-2.5 py-1 text-sm transition-colors',
              type === option
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {INTERACTION_LABELS[option]}
          </button>
        ))}
      </div>
      <Textarea
        aria-label="What happened"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={PLACEHOLDER[type]}
        rows={3}
        className="mt-2 resize-y"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && body.trim()) submit();
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {type !== 'note' && (
          <NativeSelect
            aria-label="Direction"
            value={direction}
            onChange={(event) => setDirection(event.target.value as 'outbound' | 'inbound')}
            className="h-8 w-auto"
          >
            <option value="outbound">Outgoing</option>
            <option value="inbound">Incoming</option>
          </NativeSelect>
        )}
        {type === 'call' && (
          <NativeSelect
            aria-label="Outcome"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
            className="h-8 w-auto"
          >
            <option value="connected">Connected</option>
            <option value="no_answer">No answer</option>
            <option value="left_voicemail">Left voicemail</option>
            <option value="busy">Busy</option>
          </NativeSelect>
        )}
        <span className="hidden text-xs text-muted-foreground sm:inline">⌘↵ to save</span>
        <Button size="sm" className="ml-auto" disabled={isPending || !body.trim()} onClick={submit}>
          {isPending ? 'Saving…' : `Log ${INTERACTION_LABELS[type].toLowerCase()}`}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}
