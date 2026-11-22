'use client';

import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/**
 * Tells the portal the article was shown (ADR-071): once, from the browser, so link scanners
 * that fetch pages without running scripts are not counted. A tracked link's token is sent with
 * it, then taken out of the address bar so it is not shared or bookmarked.
 */
export function ArticleViewBeacon({ slug, article }: { slug: string; article: string }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const url = new URL(window.location.href);
    const ref = url.searchParams.get('r') ?? undefined;
    if (ref) {
      url.searchParams.delete('r');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    void fetch(`/api/help/${encodeURIComponent(slug)}/view`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ article, ...(ref ? { ref } : {}) }),
      keepalive: true,
    }).catch(() => undefined);
  }, [slug, article]);
  return null;
}

/** "Was this helpful?": yes, or no with an optional reason. */
export function ArticleFeedback({ slug, article }: { slug: string; article: string }) {
  const [state, setState] = useState<'ask' | 'why' | 'thanks'>('ask');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (helpful: boolean, reason?: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/help/${encodeURIComponent(slug)}/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ article, helpful, comment: reason || undefined, website: '' }),
      });
      const result = (await response.json()) as { ok: boolean; error?: { message?: string } };
      if (!result.ok) setError(result.error?.message ?? 'That did not go through. Try again.');
      else setState('thanks');
    } catch {
      setError('That did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  };
  if (state === 'thanks') {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Thanks for telling us.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {state === 'ask' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Was this helpful?</span>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void send(true)}>
            <ThumbsUp aria-hidden /> Yes
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setState('why')}>
            <ThumbsDown aria-hidden /> No
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send(false, comment.trim());
          }}
        >
          <label htmlFor="feedback-comment" className="text-sm font-medium">
            Sorry about that. What was missing? (optional)
          </label>
          <Textarea
            id="feedback-comment"
            rows={3}
            maxLength={1000}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          {/* A field people never see; scripts fill it in. */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            className="hidden"
            aria-hidden
          />
          <Button type="submit" size="sm" className="w-fit" disabled={busy}>
            Send
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}
