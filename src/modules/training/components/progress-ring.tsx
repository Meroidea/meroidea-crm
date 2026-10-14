import { cn } from '@/lib/utils';

/** A completion ring with the percent in the middle. Pure SVG, so it renders on the server. */
export function ProgressRing({
  percent,
  size = 160,
  stroke = 12,
  label,
  className,
}: {
  /** Null when there is nothing to complete: shown as a dash on an empty ring. */
  percent: number | null;
  size?: number;
  stroke?: number;
  /** Read out instead of the bare number, e.g. "Training completed". */
  label?: string;
  className?: string;
}) {
  const clamped = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div
      role="img"
      aria-label={
        percent === null
          ? `${label ?? 'Completed'}: nothing assigned`
          : `${label ?? 'Completed'}: ${clamped}%`
      }
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className="stroke-primary transition-[stroke-dashoffset]"
        />
      </svg>
      <span
        aria-hidden
        className="absolute font-semibold tracking-tight tabular-nums"
        style={{ fontSize: Math.max(12, size * 0.2) }}
      >
        {percent === null ? '—' : `${clamped}%`}
      </span>
    </div>
  );
}

/** A thin bar for one course's completion. */
export function ProgressBar({ percent, className }: { percent: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${clamped}%` }} />
    </div>
  );
}
