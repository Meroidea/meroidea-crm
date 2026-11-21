'use client';

import { AlarmClock } from 'lucide-react';
import { useState } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { assignAction, snoozeAction } from '@/modules/social/actions';

/** Who looks after the conversation (ADR-067): a colleague who can read the inbox, or the team. */
export function AssignSelect({
  conversationId,
  assignedUserId,
  members,
  myUserId,
}: {
  conversationId: string;
  assignedUserId: string | null;
  members: { userId: string; fullName: string }[];
  myUserId: string;
}) {
  const { run, error, isPending } = useActionRunner();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="conversation-assignee">Assigned to</Label>
      <div className="flex gap-2">
        <NativeSelect
          id="conversation-assignee"
          value={assignedUserId ?? ''}
          disabled={isPending}
          onChange={(event) =>
            run(() => assignAction({ conversationId, userId: event.target.value || null }))
          }
        >
          <option value="">Whole team</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.userId === myUserId ? `${member.fullName} (me)` : member.fullName}
            </option>
          ))}
        </NativeSelect>
        {assignedUserId !== myUserId && members.some((member) => member.userId === myUserId) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0"
            disabled={isPending}
            onClick={() => run(() => assignAction({ conversationId, userId: myUserId }))}
          >
            Take it
          </Button>
        )}
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

/**
 * Sets the conversation aside (ADR-067). The quick choices are worked out on the server in the
 * business's timezone; "Pick a time" uses this device's clock.
 */
export function SnoozeControl({
  conversationId,
  snoozedLabel,
  options,
}: {
  conversationId: string;
  /** "Snoozed until …" when it is snoozed now. */
  snoozedLabel: string | null;
  options: { label: string; until: string }[];
}) {
  const { run, error, isPending } = useActionRunner();
  const [custom, setCustom] = useState('');
  const snooze = (until: string) => run(() => snoozeAction({ conversationId, until }));
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex items-center gap-1 text-sm font-medium">
        <AlarmClock aria-hidden className="size-4" /> Snooze
      </p>
      {snoozedLabel && <p className="text-sm text-muted-foreground">{snoozedLabel}</p>}
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <Button
            key={option.label}
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => snooze(option.until)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const at = new Date(custom);
          if (!Number.isNaN(at.getTime())) snooze(at.toISOString());
        }}
      >
        <Input
          type="datetime-local"
          aria-label="Snooze until"
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="h-9"
          disabled={!custom || isPending}
        >
          Snooze
        </Button>
      </form>
      <ErrorNote error={error} />
    </div>
  );
}
