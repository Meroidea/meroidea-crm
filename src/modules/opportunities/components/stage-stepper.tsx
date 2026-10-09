'use client';

import { Check, Trophy, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { stageColorVar } from '@/lib/stage-color';
import { cn } from '@/lib/utils';
import { moveStageAction } from '@/modules/opportunities/actions';

import { LostReasonDialog } from './lost-reason-dialog';

type StepStage = {
  id: string;
  name: string;
  category: 'open' | 'won' | 'lost';
  color: string | null;
};

/**
 * The record's stage stepper: open stages as steps, won/lost as the two outcomes. Clicking a
 * step moves the opportunity; lost asks for a reason first.
 */
export function StageStepper({
  opportunityId,
  stages,
  currentStageId,
  lostReasons,
  canEdit,
}: {
  opportunityId: string;
  stages: StepStage[];
  currentStageId: string;
  lostReasons: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [askLost, setAskLost] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = stages.filter((stage) => stage.category === 'open');
  const won = stages.find((stage) => stage.category === 'won');
  const lost = stages.find((stage) => stage.category === 'lost');
  const current = stages.find((stage) => stage.id === currentStageId);
  const currentIndex = open.findIndex((stage) => stage.id === currentStageId);
  const closed = current?.category !== 'open';
  // Reopening puts it back in the last open stage, where closed deals usually came from.
  const reopenTarget = open.at(-1);

  const move = (stageId: string, lostReasonId?: string, lostReasonNote?: string) =>
    startTransition(async () => {
      setError(null);
      const result = await moveStageAction({
        id: opportunityId,
        stageId,
        lostReasonId,
        lostReasonNote,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setAskLost(null);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex overflow-x-auto rounded-xl border bg-card p-1" aria-label="Stages">
        {open.map((stage, index) => {
          const reached = !closed ? index <= currentIndex : current?.category === 'won';
          const isCurrent = stage.id === currentStageId;
          return (
            <li key={stage.id} className="min-w-28 flex-1">
              <button
                type="button"
                disabled={!canEdit || isPending || isCurrent}
                onClick={() => move(stage.id)}
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'group relative flex h-10 w-full items-center justify-center gap-1.5 px-3 text-xs font-medium transition-colors',
                  'first:rounded-l-lg last:rounded-r-lg disabled:cursor-default',
                  isCurrent
                    ? 'bg-primary text-primary-foreground'
                    : reached
                      ? 'bg-accent text-accent-foreground hover:bg-accent/70'
                      : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {reached && !isCurrent ? (
                  <Check aria-hidden className="size-3.5" />
                ) : (
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ background: isCurrent ? 'currentColor' : stageColorVar(stage.color) }}
                  />
                )}
                <span className="truncate">{stage.name}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {won && current?.category !== 'won' && (
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => move(won.id)}>
              <Trophy aria-hidden className="text-positive-text" /> Mark won
            </Button>
          )}
          {lost && current?.category !== 'lost' && (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => setAskLost(lost.id)}
            >
              <XCircle aria-hidden className="text-destructive-text" /> Mark lost
            </Button>
          )}
          {closed && reopenTarget && (
            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => move(reopenTarget.id)}
            >
              Reopen
            </Button>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}
        </div>
      )}

      <LostReasonDialog
        open={askLost !== null}
        reasons={lostReasons}
        pending={isPending}
        onCancel={() => setAskLost(null)}
        onConfirm={(reasonId, note) => askLost && move(askLost, reasonId, note)}
      />
    </div>
  );
}
