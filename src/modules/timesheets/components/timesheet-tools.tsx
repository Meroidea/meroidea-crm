'use client';

import { Check, LogIn, LogOut, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { Field } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  clockInAction,
  clockOutAction,
  decideEntriesAction,
  deleteEntryAction,
  saveManualEntryAction,
} from '@/modules/timesheets/actions';

type Result =
  { ok: true } | { ok: false; error: { message: string; fieldErrors?: Record<string, string[]> } };

function useRun() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const run = (action: () => Promise<Result>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) {
        return setError(
          Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message,
        );
      }
      after?.();
      router.refresh();
    });
  return { run, error, isPending };
}

function elapsed(since: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - since) / 60_000));
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

type Position = { latitude: number; longitude: number; accuracy: number };

/** Asks the device where it is, as precisely as it can, without reusing an old reading. */
function readPosition(): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      return reject(
        new Error('This device cannot share its location, so it cannot clock in here.'),
      );
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        resolve({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
        }),
      (error) =>
        reject(
          new Error(
            error.code === error.PERMISSION_DENIED
              ? 'Location access is blocked. Allow it for this site in your browser settings, then try again.'
              : 'Your location could not be found. Check location is switched on and try again.',
          ),
        ),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  });
}

/** The big button: clock in, or clock out with the break taken. */
export function ClockCard({
  open,
  workplaceRadius,
}: {
  /** When the person clocked in, as a timestamp and as wall-clock text in the business's timezone. */
  open: { since: number; label: string } | null;
  /** Set when clocking only works near the workplace: the allowed distance in metres. */
  workplaceRadius: number | null;
}) {
  const { run, error, isPending } = useRun();
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  /** Runs a clock action, first reading the device's location when the business needs it. */
  const clock = async (
    action: (position: Position | undefined) => Promise<Result>,
    after?: () => void,
  ) => {
    setLocationError(null);
    let position: Position | undefined;
    if (workplaceRadius !== null) {
      setLocating(true);
      try {
        position = await readPosition();
      } catch (cause) {
        setLocating(false);
        return setLocationError(cause instanceof Error ? cause.message : 'Location failed.');
      }
      setLocating(false);
    }
    run(() => action(position), after);
  };
  const busy = isPending || locating;
  const problem = locationError ?? error;
  const [breakMinutes, setBreakMinutes] = useState('0');
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [open]);

  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-card p-5 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        {open ? (
          <>
            <p className="text-sm text-muted-foreground">Clocked in since {open.label}</p>
            <p className="text-3xl font-semibold tracking-tight tabular-nums">
              {now === null ? '—' : elapsed(open.since, now)}
            </p>
          </>
        ) : (
          <>
            <p className="text-lg font-semibold">You are not clocked in</p>
            <p className="text-sm text-muted-foreground">
              Press the button when you start work.{' '}
              {workplaceRadius === null
                ? 'Forgot? Use “Add time by hand”.'
                : 'Forgot? Ask a manager to add the time.'}
            </p>
          </>
        )}
        {workplaceRadius !== null && (
          <p className="mt-1 text-xs text-muted-foreground">
            Clocking works only within {workplaceRadius} m of the workplace, so your location is
            checked when you press the button.
          </p>
        )}
        {problem && (
          <p role="alert" className="mt-2 text-sm text-destructive-text">
            {problem}
          </p>
        )}
      </div>
      {open ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void clock(
              (position) => clockOutAction({ breakMinutes, position }),
              () => setBreakMinutes('0'),
            );
          }}
        >
          <Field name="clock-break" label="Break (minutes)">
            <Input
              id="clock-break"
              inputMode="numeric"
              className="w-28"
              value={breakMinutes}
              onChange={(event) => setBreakMinutes(event.target.value)}
            />
          </Field>
          <Button type="submit" size="lg" variant="destructive" disabled={busy}>
            <LogOut aria-hidden /> {locating ? 'Checking location…' : 'Clock out'}
          </Button>
        </form>
      ) : (
        <Button
          size="lg"
          disabled={busy}
          onClick={() => void clock((position) => clockInAction({ position }))}
        >
          <LogIn aria-hidden /> {locating ? 'Checking location…' : 'Clock in'}
        </Button>
      )}
    </section>
  );
}

export type EntryFormValues = {
  id?: string;
  date: string;
  start: string;
  end: string;
  breakMinutes: string;
  note: string;
};

/** Adds time by hand, or corrects an entry. */
export function EntryButton({
  entry,
  today,
  people,
}: {
  entry?: EntryFormValues;
  today: string;
  /** Given only to people who manage timesheets, so they can add time for someone else. */
  people?: { userId: string; fullName: string }[];
}) {
  const { run, error, isPending } = useRun();
  const [open, setOpen] = useState(false);
  const blank: EntryFormValues = {
    date: today,
    start: '09:00',
    end: '17:00',
    breakMinutes: '30',
    note: '',
  };
  const [values, setValues] = useState<EntryFormValues>(entry ?? blank);
  const [userId, setUserId] = useState('');
  const set = (key: keyof EntryFormValues) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  return (
    <>
      {entry ? (
        <Button
          size="sm"
          variant="ghost"
          aria-label="Correct this entry"
          onClick={() => setOpen(true)}
        >
          <Pencil aria-hidden />
        </Button>
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Plus aria-hidden /> Add time by hand
        </Button>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{entry ? 'Correct this entry' : 'Add time by hand'}</SheetTitle>
            <SheetDescription>
              {entry
                ? 'A corrected entry goes back to waiting so it is checked again.'
                : 'For time that was worked but not clocked. It waits for a manager to approve.'}
            </SheetDescription>
          </SheetHeader>
          <form
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={(event) => {
              event.preventDefault();
              run(
                () => saveManualEntryAction({ ...values, userId: entry ? undefined : userId }),
                () => {
                  setOpen(false);
                  if (!entry) setValues(blank);
                },
              );
            }}
          >
            {people && !entry && (
              <Field name="entry-person" label="Who worked it?">
                <NativeSelect
                  id="entry-person"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                >
                  <option value="">Me</option>
                  {people.map((person) => (
                    <option key={person.userId} value={person.userId}>
                      {person.fullName}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field name="entry-date" label="Date">
              <Input
                id="entry-date"
                type="date"
                required
                max={today}
                value={values.date}
                onChange={set('date')}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field name="entry-start" label="Started">
                <Input
                  id="entry-start"
                  type="time"
                  required
                  value={values.start}
                  onChange={set('start')}
                />
              </Field>
              <Field
                name="entry-end"
                label="Finished"
                hint="Earlier than the start means it ran past midnight."
              >
                <Input
                  id="entry-end"
                  type="time"
                  required
                  value={values.end}
                  onChange={set('end')}
                />
              </Field>
            </div>
            <Field name="entry-break" label="Break (minutes)">
              <Input
                id="entry-break"
                inputMode="numeric"
                value={values.breakMinutes}
                onChange={set('breakMinutes')}
              />
            </Field>
            <Field name="entry-note" label="Note (optional)">
              <Input id="entry-note" value={values.note} onChange={set('note')} />
            </Field>
            {error && (
              <p role="alert" className="text-sm text-destructive-text">
                {error}
              </p>
            )}
            <SheetFooter className="mt-auto px-0">
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Saving…' : 'Save'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Approve, reject, re-open and remove, for one entry or a whole list. */
export function EntryActions({
  ids,
  status,
  canDecide,
  canDelete,
  label,
}: {
  ids: string[];
  status: 'pending' | 'approved' | 'rejected';
  canDecide: boolean;
  canDelete: boolean;
  /** Set for the "approve all" button; one-entry buttons show icons only. */
  label?: string;
}) {
  const { run, error, isPending } = useRun();
  if (label) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          size="sm"
          disabled={isPending || ids.length === 0}
          onClick={() => run(() => decideEntriesAction({ ids, decision: 'approved' }))}
        >
          <Check aria-hidden /> {label}
        </Button>
        {error && (
          <p role="alert" className="text-xs text-destructive-text">
            {error}
          </p>
        )}
      </div>
    );
  }
  const id = ids[0];
  if (!id) return null;
  return (
    <div className="flex items-center gap-0.5">
      {canDecide && status === 'pending' && (
        <>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Approve"
            disabled={isPending}
            onClick={() => run(() => decideEntriesAction({ ids, decision: 'approved' }))}
          >
            <Check aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Reject"
            disabled={isPending}
            onClick={() => run(() => decideEntriesAction({ ids, decision: 'rejected' }))}
          >
            <X aria-hidden />
          </Button>
        </>
      )}
      {canDecide && status !== 'pending' && (
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => run(() => decideEntriesAction({ ids, decision: 'pending' }))}
        >
          Undo
        </Button>
      )}
      {canDelete && (
        <Button
          size="sm"
          variant="ghost"
          aria-label="Remove"
          disabled={isPending}
          onClick={() => run(() => deleteEntryAction({ id }))}
        >
          <Trash2 aria-hidden />
        </Button>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}
