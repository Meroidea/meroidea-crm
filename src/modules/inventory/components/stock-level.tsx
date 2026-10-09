import { cn } from '@/lib/utils';
import { formatQuantity } from '@/modules/inventory/format';
import type { StockLevel } from '@/modules/inventory/types';

const LEVELS: Record<StockLevel, { label: string; badge: string; bar: string }> = {
  ok: { label: 'In stock', badge: 'border-border text-foreground', bar: 'bg-primary' },
  low: {
    label: 'Low',
    badge: 'border-warning-border bg-warning text-warning-text',
    bar: 'bg-warning-border',
  },
  out: {
    label: 'Out',
    badge: 'border-destructive/40 bg-destructive/10 text-destructive-text',
    bar: 'bg-destructive',
  },
};

export function LevelBadge({ level }: { level: StockLevel }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap',
        LEVELS[level].badge,
      )}
    >
      {LEVELS[level].label}
    </span>
  );
}

/**
 * A gauge of stock against the reorder level: the marker sits at the level, and a full bar is
 * twice it. Drawn from rounded numbers, for the picture only; the figures shown are exact.
 */
export function LevelGauge({
  quantityOnHand,
  reorderLevel,
  level,
  unit,
}: {
  quantityOnHand: string;
  reorderLevel: string | null;
  level: StockLevel;
  unit: string;
}) {
  if (!reorderLevel || Number(reorderLevel) === 0) return null;
  const share = Math.min(1, Number(quantityOnHand) / (Number(reorderLevel) * 2));
  return (
    <div>
      <div className="relative h-2 rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-[width]', LEVELS[level].bar)}
          style={{ width: `${(share * 100).toFixed(1)}%` }}
        />
        <span aria-hidden className="absolute -top-1 left-1/2 h-4 w-px bg-foreground/50" />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Reorder at {formatQuantity(reorderLevel)} {unit}
      </p>
    </div>
  );
}
