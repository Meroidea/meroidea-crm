import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

const TINTS = ['bg-chart-1', 'bg-chart-3', 'bg-chart-4', 'bg-info', 'bg-primary'];

/** Initials avatar; the tint is derived from the name so a person keeps one colour everywhere. */
export function Avatar({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  const label = name ?? '?';
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground',
        TINTS[hash % TINTS.length],
        className,
      )}
    >
      {initials(label)}
    </span>
  );
}
