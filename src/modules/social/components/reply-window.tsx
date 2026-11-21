'use client';

import { Clock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

function left(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/**
 * The live countdown of the platform's reply window (ADR-067). When a window closes while the
 * page is open, the page reloads from the server, which then shows the right reply box: the
 * template picker on WhatsApp, the human-agent reply on Messenger and Instagram, or the reason.
 */
export function ReplyWindowBadge({
  normalEndsAt,
  humanEndsAt,
}: {
  normalEndsAt: string | null;
  humanEndsAt: string | null;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const normal = normalEndsAt ? new Date(normalEndsAt).getTime() : null;
  const human = humanEndsAt ? new Date(humanEndsAt).getTime() : null;
  const boundary = [normal, human].find((end) => end !== null && end > now) ?? null;
  useEffect(() => {
    if (boundary === null) return;
    const timer = setTimeout(
      () => router.refresh(),
      Math.max(1_000, boundary - Date.now() + 1_000),
    );
    return () => clearTimeout(timer);
  }, [boundary, router]);

  let label: string;
  let tone: 'ok' | 'warn' | 'closed';
  if (normal === null) {
    label = 'Waiting for the customer to write';
    tone = 'closed';
  } else if (normal > now) {
    label = `Reply window: ${left(normal - now)} left`;
    tone = normal - now < 3_600_000 ? 'warn' : 'ok';
  } else if (human !== null && human > now) {
    label = `Reply as a person: ${left(human - now)} left`;
    tone = human - now < 86_400_000 ? 'warn' : 'ok';
  } else {
    label = 'Reply window closed';
    tone = 'closed';
  }
  return (
    <span
      role="timer"
      aria-live="off"
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums',
        tone === 'ok' && 'border-primary/30 text-foreground',
        tone === 'warn' && 'border-warning-border bg-warning/10 text-warning-text',
        tone === 'closed' && 'bg-muted text-muted-foreground',
      )}
    >
      <Clock aria-hidden className="size-3" /> {label}
    </span>
  );
}
