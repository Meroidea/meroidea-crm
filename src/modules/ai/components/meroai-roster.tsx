'use client';

import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { addDaysToDate } from '@/lib/dates';
import { formatCalendarDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ROSTER_SPAN_DAYS, type RosterSpan } from '@/modules/roster/schemas';

import { buildRosterWithMeroAIAction } from '../actions';
import { ROSTER_STRATEGY_TEXT, type RosterPreviewArtifact, type RosterStrategy } from '../types';
import { RosterCard } from './artifact-cards';

export type MeroAIStrategyOption = {
  key: RosterStrategy;
  available: boolean;
  reason: string | null;
};

/**
 * "Ask MeroAI" on the roster page (ADR-076), beside the manual way of creating a roster. The
 * manager picks a way of working; MeroAI builds a preview to approve or discard. With `fixed`,
 * it fills the roster already open instead of choosing the period.
 */
export function MeroAIRosterCard({
  defaultStart,
  options,
  tradingHoursSet,
  canEditSettings,
  canReadNotes,
  fixed,
  className,
}: {
  defaultStart: string;
  options: MeroAIStrategyOption[];
  tradingHoursSet: boolean;
  canEditSettings: boolean;
  /** Whether a model is set up to read typed notes; the strategies themselves need none. */
  canReadNotes: boolean;
  fixed?: { startsOn: string; span: RosterSpan };
  className?: string;
}) {
  const router = useRouter();
  const [startsOn, setStartsOn] = useState(fixed?.startsOn ?? defaultStart);
  const [span, setSpan] = useState<RosterSpan>(fixed?.span ?? 'week');
  const firstAvailable =
    options.find((option) => option.key === 'even_hours' && option.available)?.key ??
    options.find((option) => option.available)?.key ??
    null;
  const [strategy, setStrategy] = useState<RosterStrategy | null>(firstAvailable);
  const [instructions, setInstructions] = useState('');
  const [preview, setPreview] = useState<{ reply: string; artifact: RosterPreviewArtifact } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const endsOn = startsOn ? addDaysToDate(startsOn, ROSTER_SPAN_DAYS[span] - 1) : '';

  const build = () =>
    strategy &&
    startTransition(async () => {
      setError(null);
      setPreview(null);
      const result = await buildRosterWithMeroAIAction({
        startsOn,
        span,
        strategy,
        instructions: instructions.trim() || undefined,
      });
      if (result.ok) setPreview(result.data);
      else setError(result.error.message);
    });

  return (
    <div
      className={cn(
        'flex w-full flex-col gap-5 rounded-xl border border-primary/30 bg-card p-6 shadow-sm',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles aria-hidden className="size-5" />
        </span>
        <div>
          <h2 className="font-medium">{fixed ? 'Fill this roster with MeroAI' : 'Ask MeroAI'}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {tradingHoursSet
              ? 'MeroAI covers your trading hours, keeps people off their leave and never double-books. You approve before anything is added.'
              : 'MeroAI builds the roster for you, keeps people off their leave and never double-books. You approve before anything is added.'}
          </p>
          {!tradingHoursSet && (
            <p className="mt-2 text-xs text-muted-foreground">
              {canEditSettings ? (
                <>
                  <Link href="/settings" className="text-primary underline underline-offset-4">
                    Set your trading hours
                  </Link>{' '}
                  so MeroAI knows when you are open.
                </>
              ) : (
                'Ask your admin to set the trading hours so MeroAI knows when you are open.'
              )}
            </p>
          )}
        </div>
      </div>

      {!fixed && (
        <div className="grid gap-3 sm:grid-cols-2">
          <fieldset>
            <legend className="text-sm font-medium">How long?</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(['week', 'fortnight'] as const).map((value) => (
                <label
                  key={value}
                  className={cn(
                    'flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm transition-colors',
                    span === value
                      ? 'border-primary bg-accent text-accent-foreground'
                      : 'hover:bg-muted',
                  )}
                >
                  <input
                    type="radio"
                    name="meroai-span"
                    className="sr-only"
                    checked={span === value}
                    onChange={() => setSpan(value)}
                  />
                  {value === 'week' ? 'Weekly' : 'Fortnightly'}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="meroai-start" className="text-sm font-medium">
              First day
            </label>
            <Input
              id="meroai-start"
              type="date"
              value={startsOn}
              onChange={(event) => setStartsOn(event.target.value)}
            />
            {endsOn && (
              <span className="text-xs text-muted-foreground">To {formatCalendarDate(endsOn)}</span>
            )}
          </div>
        </div>
      )}

      <fieldset>
        <legend className="text-sm font-medium">How should MeroAI build it?</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {options.map((option) => {
            const text = ROSTER_STRATEGY_TEXT[option.key];
            const selected = strategy === option.key;
            return (
              <label
                key={option.key}
                className={cn(
                  'flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 transition-colors',
                  !option.available && 'cursor-not-allowed opacity-60',
                  option.available && 'cursor-pointer',
                  selected
                    ? 'border-primary bg-accent text-accent-foreground'
                    : option.available && 'hover:bg-muted',
                )}
              >
                <input
                  type="radio"
                  name="meroai-strategy"
                  className="sr-only"
                  checked={selected}
                  disabled={!option.available}
                  onChange={() => setStrategy(option.key)}
                />
                <span className="text-sm font-medium">{text.title}</span>
                <span className="text-xs text-muted-foreground">
                  {option.available ? text.description : option.reason}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {canReadNotes && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="meroai-notes" className="text-sm font-medium">
            Anything MeroAI should know?{' '}
            <span className="font-normal text-muted-foreground">Optional</span>
          </label>
          <Textarea
            id="meroai-notes"
            rows={2}
            maxLength={500}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="For example: Sam can’t work Friday"
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
      <Button size="lg" onClick={build} disabled={pending || !strategy || !startsOn}>
        <Sparkles aria-hidden />
        {pending ? 'MeroAI is building your roster…' : 'Build with MeroAI'}
      </Button>

      {preview && (
        <div className="flex flex-col gap-2" aria-live="polite">
          <p className="text-sm text-muted-foreground">{preview.reply}</p>
          <RosterCard
            artifact={preview.artifact}
            onApproved={() => {
              router.push(`/roster?date=${preview.artifact.startsOn}`);
              router.refresh();
            }}
          />
        </div>
      )}
    </div>
  );
}
