'use client';

import { BookOpen } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createArticleLinkAction, searchArticlesAction } from '@/modules/kb/actions';

type Found = { id: string; title: string; summary: string | null };

/**
 * Finds a published help article and puts a link to it into a reply (ADR-071). For a known
 * customer the link is tracked, so their read shows on their timeline.
 */
export function ArticlePicker({
  target,
  onInsert,
}: {
  target: { conversationId: string } | { ticketId: string };
  onInsert: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Found[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void searchArticlesAction({ q }).then((result) => {
        if (result.ok) setResults(result.data);
      });
    }, 200);
    return () => clearTimeout(timer.current);
  }, [q, open]);

  const choose = (article: Found) =>
    startTransition(async () => {
      setError(null);
      const result = await createArticleLinkAction({ articleId: article.id, ...target });
      if (!result.ok) return setError(result.error.message);
      onInsert(`${result.data.title}: ${result.data.url}`);
      setOpen(false);
      setQ('');
    });

  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Insert a help article"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <BookOpen aria-hidden />
      </Button>
      {open && (
        <div className="absolute right-0 bottom-full z-20 mb-1 flex w-80 max-w-[85vw] flex-col gap-2 rounded-lg border bg-popover p-2 shadow-md">
          <Input
            autoFocus
            aria-label="Search help articles"
            placeholder="Search help articles…"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false);
            }}
          />
          <ul className="max-h-60 overflow-y-auto text-sm" aria-label="Help articles">
            {results.length === 0 && (
              <li className="px-2 py-1.5 text-muted-foreground">No published article matches.</li>
            )}
            {results.map((article) => (
              <li key={article.id}>
                <button
                  type="button"
                  disabled={isPending}
                  className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  onClick={() => choose(article)}
                >
                  <span className="font-medium">{article.title}</span>
                  {article.summary && (
                    <span className="line-clamp-1 text-xs text-muted-foreground">
                      {article.summary}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="px-1 text-xs text-destructive-text">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
