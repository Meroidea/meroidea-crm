'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CalendarClock, Clock3 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Avatar } from '@/components/data/avatar';
import { NativeSelect } from '@/components/forms/native-select';
import { formatMoney } from '@/lib/format';
import { stageColorVar } from '@/lib/stage-color';
import { cn } from '@/lib/utils';
import { moveStageAction } from '@/modules/opportunities/actions';
import type { BoardCard, BoardColumn } from '@/modules/opportunities/types';

import { LostReasonDialog } from './lost-reason-dialog';

type Props = {
  columns: BoardColumn[];
  currency: string;
  lostReasons: { id: string; name: string }[];
  canEdit: boolean;
};

function moveCard(columns: BoardColumn[], cardId: string, toStageId: string): BoardColumn[] {
  const card = columns
    .flatMap((column) => column.cards)
    .find((candidate) => candidate.id === cardId);
  if (!card) return columns;
  return columns.map((column) => {
    if (column.stageId === toStageId && card.stageId !== toStageId) {
      return {
        ...column,
        count: column.count + 1,
        cards: [
          { ...card, stageId: toStageId, stageName: column.name, daysInStage: 0, isStale: false },
          ...column.cards,
        ],
      };
    }
    if (column.stageId === card.stageId && column.stageId !== toStageId) {
      return {
        ...column,
        count: column.count - 1,
        cards: column.cards.filter((candidate) => candidate.id !== cardId),
      };
    }
    return column;
  });
}

function Card({
  card,
  currency,
  dragging = false,
}: {
  card: BoardCard;
  currency: string;
  dragging?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-3 text-sm shadow-xs transition-shadow',
        dragging && 'rotate-1 shadow-lg ring-2 ring-primary/40',
        card.isStale && 'border-warning-border',
      )}
    >
      <Link
        href={`/opportunities/${card.id}`}
        className="block font-medium hover:text-primary"
        draggable={false}
      >
        {card.name}
      </Link>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{card.contactName}</p>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold tabular-nums">
          {card.amount
            ? formatMoney(card.amount, card.currency ?? currency, { compact: true })
            : ''}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            title={card.isStale ? 'No recent activity' : 'Days in this stage'}
            className={cn(
              'inline-flex items-center gap-0.5 rounded px-1 text-[11px] tabular-nums',
              card.isStale ? 'bg-warning font-medium text-warning-text' : 'text-muted-foreground',
            )}
          >
            <Clock3 aria-hidden className="size-3" />
            {card.daysInStage}d
          </span>
          {card.nextTaskDueAt && (
            <CalendarClock aria-label="Follow-up scheduled" className="size-3.5 text-primary" />
          )}
          <Avatar name={card.ownerName ?? 'Unassigned'} className="size-5 text-[8px]" />
        </span>
      </div>
    </div>
  );
}

function DraggableCard({
  card,
  currency,
  disabled,
}: {
  card: BoardCard;
  currency: string;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id, disabled });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn('touch-none', isDragging && 'opacity-30')}
    >
      <Card card={card} currency={currency} />
    </div>
  );
}

function Column({
  column,
  currency,
  canEdit,
}: {
  column: BoardColumn;
  currency: string;
  canEdit: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stageId });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${column.name}, ${column.count}`}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-xl border-t-4 bg-muted/50 transition-colors',
        isOver && 'bg-accent ring-2 ring-primary/30',
      )}
      style={{ borderTopColor: stageColorVar(column.color) }}
    >
      <header className="flex items-baseline justify-between gap-2 px-3 pt-3 pb-2">
        <h2 className="truncate text-sm font-semibold">
          {column.name}
          <span className="ml-1.5 font-normal text-muted-foreground">{column.count}</span>
        </h2>
        {column.total && Number(column.total) > 0 && (
          <span className="text-xs font-medium text-muted-foreground tabular-nums">
            {formatMoney(column.total, currency, { compact: true })}
          </span>
        )}
      </header>
      {column.category !== 'open' && (
        <p className="-mt-1 px-3 pb-1 text-[11px] text-muted-foreground">Last 30 days</p>
      )}
      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {column.cards.map((card) => (
          <DraggableCard key={card.id} card={card} currency={currency} disabled={!canEdit} />
        ))}
        {column.cards.length === 0 && (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            {canEdit ? 'Drop here' : 'Empty'}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Kanban board (docs/architecture.md §6): drag between columns → optimistic move → server
 * action; dropping on a lost column asks for the reason first. Phones get a stage picker and a
 * list with a "Move to" menu instead of drag.
 */
export function PipelineBoard({ columns: initial, currency, lostReasons, canEdit }: Props) {
  const router = useRouter();
  const [columns, setColumns] = useState(initial);
  const [synced, setSynced] = useState(initial);
  const [active, setActive] = useState<BoardCard | null>(null);
  const [pendingLost, setPendingLost] = useState<{ cardId: string; stageId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mobileStage, setMobileStage] = useState(initial[0]?.stageId ?? '');
  const [isPending, startTransition] = useTransition();

  // Server data changed (after refresh): adopt it.
  if (initial !== synced) {
    setSynced(initial);
    setColumns(initial);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const commit = (
    cardId: string,
    stageId: string,
    lostReasonId?: string,
    lostReasonNote?: string,
  ) => {
    const before = columns;
    setColumns(moveCard(columns, cardId, stageId));
    startTransition(async () => {
      setError(null);
      const result = await moveStageAction({ id: cardId, stageId, lostReasonId, lostReasonNote });
      if (!result.ok) {
        setColumns(before);
        setError(result.error.message);
        return;
      }
      setPendingLost(null);
      router.refresh();
    });
  };

  const request = (cardId: string, stageId: string) => {
    const target = columns.find((column) => column.stageId === stageId);
    const card = columns
      .flatMap((column) => column.cards)
      .find((candidate) => candidate.id === cardId);
    if (!target || !card || card.stageId === stageId) return;
    if (target.category === 'lost') setPendingLost({ cardId, stageId });
    else commit(cardId, stageId);
  };

  const onDragStart = (event: DragStartEvent) =>
    setActive(
      columns.flatMap((column) => column.cards).find((card) => card.id === event.active.id) ?? null,
    );
  const onDragEnd = (event: DragEndEvent) => {
    setActive(null);
    if (event.over) request(String(event.active.id), String(event.over.id));
  };

  const mobileColumn = columns.find((column) => column.stageId === mobileStage) ?? columns[0];

  return (
    <>
      {error && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
        >
          {error}
        </p>
      )}

      {/* Phones: stage picker + list. */}
      <div className="flex flex-col gap-3 md:hidden">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {columns.map((column) => (
            <button
              key={column.stageId}
              type="button"
              onClick={() => setMobileStage(column.stageId)}
              aria-pressed={column.stageId === mobileColumn?.stageId}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm',
                column.stageId === mobileColumn?.stageId
                  ? 'border-primary bg-accent font-medium'
                  : 'bg-card',
              )}
            >
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ background: stageColorVar(column.color) }}
              />
              {column.name}
              <span className="text-muted-foreground">{column.count}</span>
            </button>
          ))}
        </div>
        {mobileColumn?.cards.map((card) => (
          <div key={card.id} className="flex flex-col gap-2">
            <Card card={card} currency={currency} />
            {canEdit && (
              <NativeSelect
                aria-label={`Move ${card.name} to`}
                value=""
                disabled={isPending}
                onChange={(event) => event.target.value && request(card.id, event.target.value)}
                className="h-8"
              >
                <option value="">Move to…</option>
                {columns
                  .filter((column) => column.stageId !== card.stageId)
                  .map((column) => (
                    <option key={column.stageId} value={column.stageId}>
                      {column.name}
                    </option>
                  ))}
              </NativeSelect>
            )}
          </div>
        ))}
        {mobileColumn && mobileColumn.cards.length === 0 && (
          <p className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
            Nothing in this stage.
          </p>
        )}
      </div>

      <DndContext
        // A fixed id keeps dnd-kit's accessibility ids identical on server and client.
        id="pipeline-board"
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActive(null)}
      >
        <div className="-mx-4 hidden gap-3 overflow-x-auto px-4 pb-4 md:-mx-6 md:flex md:min-h-[calc(100svh-15rem)] md:px-6">
          {columns.map((column) => (
            <Column key={column.stageId} column={column} currency={currency} canEdit={canEdit} />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {active ? <Card card={active} currency={currency} dragging /> : null}
        </DragOverlay>
      </DndContext>

      <LostReasonDialog
        open={pendingLost !== null}
        reasons={lostReasons}
        pending={isPending}
        onCancel={() => setPendingLost(null)}
        onConfirm={(reasonId, note) =>
          pendingLost && commit(pendingLost.cardId, pendingLost.stageId, reasonId, note)
        }
      />
    </>
  );
}
