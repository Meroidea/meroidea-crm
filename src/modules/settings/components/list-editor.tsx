'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ActionResult } from '@/lib/errors';
import { cn } from '@/lib/utils';

/** A simple configurable list: add an item, switch items on and off (never delete — history keeps them). */
export function ListEditor({
  items,
  addLabel,
  onAdd,
  onToggle,
}: {
  items: { id: string; name: string; isActive: boolean; hint?: string }[];
  addLabel: string;
  onAdd: (name: string) => Promise<ActionResult<unknown>>;
  onToggle: (id: string, isActive: boolean) => Promise<ActionResult<unknown>>;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const run = (fn: () => Promise<ActionResult<unknown>>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) setError(result.error.message);
      else after?.();
      router.refresh();
    });

  return (
    <div className={cn('flex max-w-2xl flex-col gap-3', isPending && 'opacity-80')}>
      <ul className="flex flex-col divide-y rounded-xl border bg-card">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className={cn('text-sm', !item.isActive && 'text-muted-foreground line-through')}>
              {item.name}
              {item.hint && <span className="ml-2 text-xs text-muted-foreground">{item.hint}</span>}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => run(() => onToggle(item.id, !item.isActive))}
            >
              {item.isActive ? 'Turn off' : 'Turn on'}
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim())
            run(
              () => onAdd(name),
              () => setName(''),
            );
        }}
      >
        <Input
          aria-label={addLabel}
          placeholder={addLabel}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={!name.trim()}>
          <Plus aria-hidden /> Add
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}
