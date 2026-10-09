'use client';

import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { stageColorVar } from '@/lib/stage-color';
import { cn } from '@/lib/utils';
import {
  addStageAction,
  moveStagePositionAction,
  toggleStageAction,
  updateStageAction,
} from '@/modules/settings/actions';
import { STAGE_COLORS } from '@/modules/settings/schemas';

type Stage = {
  id: string;
  name: string;
  category: 'open' | 'won' | 'lost';
  probability: number | null;
  color: string | null;
  staleAfterDays: number | null;
  isActive: boolean;
};

function StageRow({
  stage,
  first,
  last,
  run,
}: {
  stage: Stage;
  first: boolean;
  last: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => void;
}) {
  const [name, setName] = useState(stage.name);
  const [probability, setProbability] = useState(String(stage.probability ?? 0));
  const [stale, setStale] = useState(stage.staleAfterDays ? String(stage.staleAfterDays) : '');
  const [color, setColor] = useState(stage.color ?? 'chart-3');
  const dirty =
    name !== stage.name ||
    probability !== String(stage.probability ?? 0) ||
    stale !== (stage.staleAfterDays ? String(stage.staleAfterDays) : '') ||
    color !== (stage.color ?? 'chart-3');
  const open = stage.category === 'open';

  return (
    <li
      className={cn(
        'grid grid-cols-[auto_1fr] items-center gap-3 rounded-xl border bg-card p-3 md:grid-cols-[auto_1.4fr_0.7fr_0.8fr_0.9fr_auto]',
        !stage.isActive && 'opacity-60',
      )}
    >
      <span
        aria-hidden
        className="size-3 rounded-full"
        style={{ background: stageColorVar(color) }}
      />
      <div className="flex items-center gap-2">
        <Input
          aria-label="Stage name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8"
        />
        {!open && (
          <Badge variant={stage.category === 'won' ? 'secondary' : 'destructive'}>
            {stage.category}
          </Badge>
        )}
      </div>
      <label className="col-span-2 flex items-center gap-2 text-xs text-muted-foreground md:col-span-1">
        Probability
        <Input
          aria-label="Probability %"
          inputMode="numeric"
          value={probability}
          onChange={(e) => setProbability(e.target.value)}
          className="h-8 w-16"
        />
        %
      </label>
      <label className="col-span-2 flex items-center gap-2 text-xs text-muted-foreground md:col-span-1">
        {open ? (
          <>
            Stale after
            <Input
              aria-label="Stale after days"
              inputMode="numeric"
              value={stale}
              onChange={(e) => setStale(e.target.value)}
              className="h-8 w-14"
            />
            d
          </>
        ) : (
          'Closed stage'
        )}
      </label>
      <NativeSelect
        aria-label="Colour"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="col-span-2 h-8 md:col-span-1"
      >
        {STAGE_COLORS.map((option) => (
          <option key={option} value={option}>
            {option.replace('chart-', 'Colour ')}
          </option>
        ))}
      </NativeSelect>
      <div className="col-span-2 flex flex-wrap items-center justify-end gap-1 md:col-span-1">
        {open && (
          <>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Move up"
              disabled={first}
              onClick={() => run(() => moveStagePositionAction({ id: stage.id, direction: 'up' }))}
            >
              <ArrowUp aria-hidden />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Move down"
              disabled={last}
              onClick={() =>
                run(() => moveStagePositionAction({ id: stage.id, direction: 'down' }))
              }
            >
              <ArrowDown aria-hidden />
            </Button>
          </>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => run(() => toggleStageAction({ id: stage.id, isActive: !stage.isActive }))}
        >
          {stage.isActive ? 'Hide' : 'Show'}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!dirty}
          onClick={() =>
            run(() =>
              updateStageAction({
                id: stage.id,
                name,
                probability: Number(probability),
                staleAfterDays: stale,
                color: color as (typeof STAGE_COLORS)[number],
              }),
            )
          }
        >
          Save
        </Button>
      </div>
    </li>
  );
}

export function StageEditor({ stages }: { stages: Stage[] }) {
  const router = useRouter();
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) setError(result.error?.message ?? 'Something went wrong.');
      router.refresh();
    });
  const open = stages.filter((stage) => stage.category === 'open');

  return (
    <div className={cn('flex flex-col gap-3', isPending && 'opacity-80')}>
      {error && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
        >
          {error}
        </p>
      )}
      <ol className="flex flex-col gap-2">
        {stages.map((stage) => (
          <StageRow
            key={`${stage.id}-${stage.name}-${stage.probability}-${stage.staleAfterDays}-${stage.color}`}
            stage={stage}
            first={open[0]?.id === stage.id}
            last={open.at(-1)?.id === stage.id}
            run={run}
          />
        ))}
      </ol>
      <form
        className="flex max-w-md gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!newName.trim()) return;
          run(async () => {
            const result = await addStageAction({ name: newName });
            if (result.ok) setNewName('');
            return result;
          });
        }}
      >
        <Input
          aria-label="New stage name"
          placeholder="New stage name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={!newName.trim()}>
          <Plus aria-hidden /> Add stage
        </Button>
      </form>
    </div>
  );
}
