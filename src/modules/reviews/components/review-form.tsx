'use client';

import { Heart, Star } from 'lucide-react';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

/** The public review form: tap a star, optionally say more, send. Built for a phone. */
export function ReviewForm({ token }: { token: string }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [contactAllowed, setContactAllowed] = useState(false);
  const [website, setWebsite] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (done) {
    return (
      <div role="status" className="flex flex-col items-center gap-2 py-8 text-center">
        <Heart aria-hidden className="size-10 fill-primary text-primary" />
        <p className="text-lg font-semibold">Thank you</p>
        <p className="text-sm text-muted-foreground">Your review has been passed on to the team.</p>
      </div>
    );
  }

  const shown = hover || rating;
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (rating === 0) return setError('Tap a star to choose your rating.');
        startTransition(async () => {
          setError(null);
          try {
            const response = await fetch(`/api/reviews/${token}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                rating,
                comment,
                customerName: name,
                customerEmail: email,
                contactAllowed,
                website,
              }),
            });
            const reply = (await response.json()) as {
              ok: boolean;
              error?: { message: string; fieldErrors?: Record<string, string[]> };
            };
            if (reply.ok) return setDone(true);
            setError(
              Object.values(reply.error?.fieldErrors ?? {})[0]?.[0] ??
                reply.error?.message ??
                'Something went wrong. Try again.',
            );
          } catch {
            setError('Could not send your review. Check your connection and try again.');
          }
        });
      }}
    >
      <fieldset className="flex flex-col items-center gap-2">
        <legend className="sr-only">Your rating</legend>
        <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((value) => (
            <label
              key={value}
              className="cursor-pointer rounded-md p-1 has-focus-visible:ring-2 has-focus-visible:ring-ring"
            >
              <input
                type="radio"
                name="rating"
                value={value}
                checked={rating === value}
                onChange={() => setRating(value)}
                className="sr-only"
              />
              <Star
                aria-hidden
                onMouseEnter={() => setHover(value)}
                className={cn(
                  'size-11 text-border transition-colors',
                  value <= shown && 'fill-chart-3 text-chart-3',
                )}
              />
              <span className="sr-only">
                {value} out of 5, {WORDS[value]}
              </span>
            </label>
          ))}
        </div>
        <p className="h-5 text-sm font-medium" aria-live="polite">
          {WORDS[shown]}
        </p>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="review-comment">Tell us more (optional)</Label>
        <Textarea
          id="review-comment"
          rows={4}
          maxLength={2000}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="review-name">Your name (optional)</Label>
          <Input
            id="review-name"
            autoComplete="name"
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="review-email">Email (optional)</Label>
          <Input
            id="review-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
      </div>
      {email && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={contactAllowed}
            onChange={(event) => setContactAllowed(event.target.checked)}
          />
          The team may contact me about this review.
        </label>
      )}
      {/* Hidden from people; scripts that fill every field give themselves away. */}
      <div aria-hidden className="absolute -left-[9999px] size-px overflow-hidden">
        <label>
          Website
          <input
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={isPending}>
        {isPending ? 'Sending…' : 'Send review'}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Your review goes privately to this business. It is not published.
      </p>
    </form>
  );
}
