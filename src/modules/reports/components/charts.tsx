import { stageColorVar } from '@/lib/stage-color';

/** Horizontal bars with a label and a value; widths relative to the largest entry. */
export function BarList({
  rows,
  emptyText = 'No data yet.',
}: {
  rows: {
    key: string;
    label: string;
    value: number;
    display: string;
    color?: string | null;
    hint?: string;
  }[];
  emptyText?: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (rows.length === 0 || rows.every((row) => row.value === 0)) {
    return <p className="py-4 text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate">{row.label}</span>
            <span className="shrink-0 font-medium tabular-nums">
              {row.display}
              {row.hint && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">{row.hint}</span>
              )}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(2, (row.value / max) * 100)}%`,
                background: row.color ? stageColorVar(row.color) : 'var(--primary)',
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Monthly columns (e.g. won value) with a line on top (e.g. new opportunities). */
export function TrendChart({
  points,
  barLabel,
  lineLabel,
}: {
  points: { label: string; bar: number; line: number; barDisplay: string }[];
  barLabel: string;
  lineLabel: string;
}) {
  const maxBar = Math.max(1, ...points.map((point) => point.bar));
  const maxLine = Math.max(1, ...points.map((point) => point.line));
  const step = 100 / points.length;
  const line = points
    .map(
      (point, index) =>
        `${(index * step + step / 2).toFixed(2)},${(58 - (point.line / maxLine) * 50).toFixed(2)}`,
    )
    .join(' ');

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-primary" /> {barLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded bg-chart-5" /> {lineLabel}
        </span>
      </figcaption>
      <svg
        viewBox="0 0 100 62"
        preserveAspectRatio="none"
        className="h-44 w-full"
        role="img"
        aria-label={`${barLabel} and ${lineLabel} by month`}
      >
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1="0"
            x2="100"
            y1={60 - fraction * 56}
            y2={60 - fraction * 56}
            stroke="var(--border)"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {points.map((point, index) => {
          const height = (point.bar / maxBar) * 56;
          return (
            <rect
              key={point.label}
              x={index * step + step * 0.2}
              width={step * 0.6}
              y={60 - height}
              height={Math.max(height, 0.4)}
              rx="1"
              fill="var(--primary)"
              opacity={0.35 + (index / Math.max(1, points.length - 1)) * 0.65}
            >
              <title>{`${point.label}: ${point.barDisplay} · ${point.line} new`}</title>
            </rect>
          );
        })}
        <polyline
          points={line}
          fill="none"
          stroke="var(--chart-5)"
          strokeWidth="2"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {points.map((point, index) => (
          <circle
            key={`${point.label}-dot`}
            cx={index * step + step / 2}
            cy={58 - (point.line / maxLine) * 50}
            r="0.9"
            fill="var(--card)"
            stroke="var(--chart-5)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="flex text-xs text-muted-foreground">
        {points.map((point) => (
          <span key={point.label} className="flex-1 text-center">
            {point.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

export function Ring({ value, label }: { value: number | null; label: string }) {
  const circumference = 2 * Math.PI * 16;
  const amount = value ?? 0;
  return (
    <svg
      viewBox="0 0 40 40"
      className="size-14 -rotate-90"
      role="img"
      aria-label={`${label}: ${value ?? 'no data'}%`}
    >
      <circle cx="20" cy="20" r="16" fill="none" stroke="var(--muted)" strokeWidth="5" />
      <circle
        cx="20"
        cy="20"
        r="16"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${(circumference * amount) / 100} ${circumference}`}
      />
    </svg>
  );
}
