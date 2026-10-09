import { stageColorVar } from '@/lib/stage-color';

export function StageBadge({ name, color }: { name: string; color: string | null }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-xs font-medium">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ background: stageColorVar(color) }}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}
