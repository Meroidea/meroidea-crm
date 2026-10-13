'use client';

import { Mail, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { publishRosterAction } from '@/modules/roster/actions';
import type { RemovedShift, RosterPerson, RosterShift } from '@/modules/roster/types';

const SCOPES = [
  {
    value: 'changes',
    title: 'Changes only',
    hint: 'Only people whose shifts were added, changed or removed are told.',
  },
  {
    value: 'all',
    title: 'Everyone',
    hint: 'Everyone working this roster is told, changed or not.',
  },
] as const;

const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? '' : 's'}`;

/** Three steps on one panel: what to publish, whether to email it, and a check of who gets it. */
export function PublishSheet({
  rosterId,
  period,
  shifts,
  removed,
  people,
  onClose,
  onPublished,
}: {
  rosterId: string;
  period: string;
  shifts: RosterShift[];
  removed: RemovedShift[];
  people: RosterPerson[];
  onClose: () => void;
  onPublished: (summary: string) => void;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<(typeof SCOPES)[number]['value']>('changes');
  const [notify, setNotify] = useState(false);
  const [message, setMessage] = useState('');
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const pending = useMemo(() => shifts.filter((shift) => shift.unpublishedChanges), [shifts]);
  const changeCount = pending.length + removed.length;

  const recipients = useMemo(() => {
    const nameOf = new Map(people.map((person) => [person.userId, person.fullName]));
    const changed = new Map<string, number>();
    for (const item of [...pending, ...removed]) {
      if (item.userId) changed.set(item.userId, (changed.get(item.userId) ?? 0) + 1);
    }
    const working = new Map<string, number>();
    for (const shift of shifts) {
      if (shift.userId) working.set(shift.userId, (working.get(shift.userId) ?? 0) + 1);
    }
    const ids = new Set([...changed.keys(), ...(scope === 'all' ? working.keys() : [])]);
    return [...ids]
      .map((userId) => ({
        userId,
        fullName: nameOf.get(userId) ?? 'Former member',
        shifts: working.get(userId) ?? 0,
        changed: changed.get(userId) ?? 0,
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [people, shifts, pending, removed, scope]);
  const emailing = recipients.filter((person) => !skipped.includes(person.userId));
  const vacant = pending.filter((shift) => shift.userId === null).length;

  const publish = () =>
    startTransition(async () => {
      setError(null);
      const result = await publishRosterAction({
        id: rosterId,
        scope,
        notify,
        message,
        skipUserIds: skipped,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const { published, emailed, emailConfigured } = result.data;
      const parts = [published > 0 ? `Published ${count(published, 'change')}.` : 'Published.'];
      if (notify) {
        parts.push(
          emailConfigured
            ? `Emailed ${emailed === 1 ? '1 person' : `${emailed} people`}.`
            : 'Email is not set up on this server, so nobody was emailed.',
        );
      }
      onPublished(parts.join(' '));
      onClose();
      router.refresh();
    });

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Review and publish</SheetTitle>
          <SheetDescription>
            {period}. Staff only see a shift once it has been published.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4">
          <fieldset>
            <legend className="text-sm font-medium">1. Who should hear about it?</legend>
            <div className="mt-2 grid gap-2">
              {SCOPES.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    'flex cursor-pointer flex-col rounded-lg border px-3 py-2.5 transition-colors has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50',
                    scope === option.value
                      ? 'border-primary bg-accent text-accent-foreground'
                      : 'hover:bg-muted',
                  )}
                >
                  <input
                    type="radio"
                    name="scope"
                    value={option.value}
                    checked={scope === option.value}
                    onChange={() => setScope(option.value)}
                    className="sr-only"
                  />
                  <span className="text-sm font-medium">{option.title}</span>
                  <span className="text-xs text-muted-foreground">{option.hint}</span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {changeCount === 0
                ? 'Nothing has changed since the last publish.'
                : `${count(pending.length, 'shift')} added or changed${
                    removed.length ? `, ${removed.length} removed` : ''
                  }${vacant ? `, ${vacant} of them vacant` : ''}.`}
            </p>
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium">2. How do they receive it?</legend>
            <p className="mt-2 text-sm text-muted-foreground">
              Everyone can open the roster here at any time.
            </p>
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={notify}
                onChange={(event) => setNotify(event.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                <span className="flex items-center gap-1.5 font-medium">
                  <Mail aria-hidden className="size-3.5" /> Also email each person their shifts
                </span>
                <span className="block text-xs text-muted-foreground">
                  Each email lists only that person’s own shifts.
                </span>
              </span>
            </label>
            {notify && (
              <Textarea
                rows={2}
                maxLength={500}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Add a message (optional)"
                aria-label="Message to include in the email"
              />
            )}
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">3. Check before publishing</legend>
            {recipients.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No one’s shifts are affected.</p>
            ) : (
              <ul className="mt-2 divide-y rounded-lg border">
                {recipients.map((person) => (
                  <li key={person.userId}>
                    <label className="flex items-center gap-2.5 px-3 py-2 text-sm">
                      {notify && (
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={!skipped.includes(person.userId)}
                          onChange={(event) =>
                            setSkipped((current) =>
                              event.target.checked
                                ? current.filter((userId) => userId !== person.userId)
                                : [...current, person.userId],
                            )
                          }
                          aria-label={`Email ${person.fullName}`}
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate font-medium" data-sensitive>
                        {person.fullName}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {count(person.shifts, 'shift')}
                        {person.changed > 0 && ` · ${person.changed} changed`}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {notify && recipients.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {emailing.length} of {recipients.length} will be emailed. Unticking someone only
                skips their email; their shifts are still published.
              </p>
            )}
          </fieldset>

          {error && (
            <p role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}
        </div>

        <SheetFooter className="flex-row items-center">
          <Button type="button" variant="outline" className="ml-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={isPending} onClick={publish}>
            <Send aria-hidden />
            {changeCount > 0 ? `Publish ${count(changeCount, 'change')}` : 'Publish'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
