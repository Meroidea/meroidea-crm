'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateWorkspaceAction } from '@/modules/settings/actions';

type Workspace = { name: string; timezone: string; currency: string; country: string };

export function WorkspaceForm({ initial }: { initial: Workspace }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const field = (key: keyof Workspace, label: string, hint?: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`ws-${key}`}>{label}</Label>
      <Input
        id={`ws-${key}`}
        value={values[key]}
        onChange={(event) => setValues({ ...values, [key]: event.target.value })}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );

  return (
    <form
      className="grid max-w-2xl gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await updateWorkspaceAction(values);
          setMessage(
            result.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: result.error.message },
          );
          if (result.ok) router.refresh();
        });
      }}
    >
      {field('name', 'Workspace name')}
      {field(
        'timezone',
        'Timezone',
        'IANA name, e.g. Australia/Sydney — dates and "today" use it.',
      )}
      {field('currency', 'Default currency', '3-letter code, e.g. AUD')}
      {field('country', 'Country', '2-letter code, used to read local phone numbers')}
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save'}
        </Button>
        {message && (
          <p
            role="status"
            className={
              message.ok ? 'text-sm text-muted-foreground' : 'text-sm text-destructive-text'
            }
          >
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}
