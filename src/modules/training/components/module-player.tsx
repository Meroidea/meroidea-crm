'use client';

import { CheckCircle2, RotateCcw, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { submitModuleAction } from '@/modules/training/actions';

type Question = { id: string; prompt: string; options: string[] };

/**
 * Completes a module: answers its quiz, or marks it done when it has none. Marking happens on
 * the server; this only ever learns whether the person passed and their score.
 */
export function ModulePlayer({
  moduleId,
  questions,
  passMark,
  alreadyPassed,
  nextHref,
  courseHref,
}: {
  moduleId: string;
  questions: Question[];
  passMark: number;
  alreadyPassed: boolean;
  nextHref: string | null;
  courseHref: string;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<{ passed: boolean; score: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const answered = questions.every((question) => answers[question.id] !== undefined);

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const sent = await submitModuleAction({ id: moduleId, answers });
      if (!sent.ok) return setError(sent.error.message);
      setResult(sent.data);
      router.refresh();
    });

  if (result) {
    return (
      <div
        role="status"
        className={cn(
          'flex flex-col gap-3 rounded-xl border p-5',
          result.passed ? 'bg-accent/60' : 'border-destructive/30 bg-destructive/5',
        )}
      >
        <p className="flex items-center gap-2 font-medium">
          {result.passed ? (
            <CheckCircle2 aria-hidden className="size-5 text-primary" />
          ) : (
            <XCircle aria-hidden className="size-5 text-destructive-text" />
          )}
          {result.passed
            ? result.score === null
              ? 'Done. Thank you.'
              : `Passed with ${result.score}%.`
            : `${result.score}%: you need ${passMark}% to pass.`}
        </p>
        <div className="flex flex-wrap gap-2">
          {!result.passed && (
            <Button
              variant="outline"
              onClick={() => {
                setResult(null);
                setAnswers({});
              }}
            >
              <RotateCcw aria-hidden /> Try again
            </Button>
          )}
          {result.passed && nextHref && (
            <Button asChild>
              <Link href={nextHref}>Next module</Link>
            </Button>
          )}
          <Button asChild variant={result.passed && nextHref ? 'outline' : 'default'}>
            <Link href={courseHref}>Back to my training</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <p className="text-sm text-muted-foreground">
          {alreadyPassed
            ? 'You have already done this module.'
            : 'When you have read and understood this module, mark it as done.'}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive-text">
            {error}
          </p>
        )}
        {!alreadyPassed && (
          <Button className="self-start" disabled={isPending} onClick={submit}>
            <CheckCircle2 aria-hidden /> I have read and understood this
          </Button>
        )}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-5 rounded-xl border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">Quiz</h2>
        <p className="text-sm text-muted-foreground">
          {questions.length} {questions.length === 1 ? 'question' : 'questions'}. You need{' '}
          {passMark}% to pass
          {alreadyPassed ? '; you have already passed, so this is practice.' : '.'}
        </p>
      </div>
      <ol className="flex flex-col gap-5">
        {questions.map((question, index) => (
          <li key={question.id}>
            <fieldset>
              <legend className="text-sm font-medium">
                {index + 1}. {question.prompt}
              </legend>
              <div className="mt-2 flex flex-col gap-1.5">
                {question.options.map((option, choice) => (
                  <label
                    key={choice}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors',
                      answers[question.id] === choice
                        ? 'border-primary bg-accent'
                        : 'hover:bg-muted',
                    )}
                  >
                    <input
                      type="radio"
                      name={question.id}
                      checked={answers[question.id] === choice}
                      onChange={() => setAnswers({ ...answers, [question.id]: choice })}
                      className="mt-0.5 size-4 accent-primary"
                    />
                    {option}
                  </label>
                ))}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
      <Button type="submit" className="self-start" disabled={isPending || !answered}>
        {isPending ? 'Marking…' : 'Submit answers'}
      </Button>
    </form>
  );
}
