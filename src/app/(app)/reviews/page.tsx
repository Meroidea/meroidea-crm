import { MessageSquareHeart, QrCode, Star } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import { qrSvg } from '@/lib/qr';
import { cn } from '@/lib/utils';
import {
  ReviewHandling,
  ReviewLinkActions,
  ReviewLinkButton,
} from '@/modules/reviews/components/review-tools';
import { getReviewSummary, listReviewLinks, listReviews } from '@/modules/reviews/queries';
import { REVIEW_STATUS_LABELS, reviewParamsSchema } from '@/modules/reviews/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';
import { serverEnv } from '@/server/env';

export const metadata: Metadata = { title: 'Reviews' };

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex" role="img" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          aria-hidden
          className={cn('size-4 text-border', value <= rating && 'fill-chart-3 text-chart-3')}
        />
      ))}
    </span>
  );
}

export default async function ReviewsPage({ searchParams }: PageProps<'/reviews'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'reviews.view');
  const canManage = hasPermission(ctx, 'reviews.manage');
  const params = reviewParamsSchema.parse(await searchParams);
  const view = params.view ?? 'inbox';
  const [summary, links, reviews] = await Promise.all([
    getReviewSummary(ctx),
    listReviewLinks(ctx),
    view === 'inbox' ? listReviews(ctx, { status: params.status, rating: params.rating }) : [],
  ]);
  const base = serverEnv().APP_URL;
  const most = Math.max(1, ...summary.distribution);

  const filterHref = (changes: { status?: string | undefined; rating?: number | undefined }) => {
    const query = new URLSearchParams();
    const status = 'status' in changes ? changes.status : params.status;
    const rating = 'rating' in changes ? changes.rating : params.rating;
    if (status) query.set('status', status);
    if (rating) query.set('rating', String(rating));
    const text = query.toString();
    return text ? `/reviews?${text}` : '/reviews';
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Reviews"
        description="What customers say, from the links and QR codes you hand out."
        actions={canManage && <ReviewLinkButton />}
      />

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.4fr]">
        <div className="rounded-xl border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">Average rating</p>
          <p className="mt-1 flex items-baseline gap-2 text-3xl font-semibold tracking-tight tabular-nums">
            {summary.average ?? '—'}
            <span className="text-sm font-normal text-muted-foreground">
              from {summary.total} {summary.total === 1 ? 'review' : 'reviews'}
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Last 30 days: {summary.average30 ?? '—'} from {summary.last30}
          </p>
        </div>
        <div className="rounded-xl border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">Waiting to be read</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
            {summary.waiting}
          </p>
          <Link
            href="/reviews?status=new"
            className="mt-1 block text-xs text-primary underline-offset-4 hover:underline"
          >
            Show new reviews
          </Link>
        </div>
        <div className="flex flex-col justify-center gap-1 rounded-xl border bg-card px-4 py-3">
          {[5, 4, 3, 2, 1].map((stars) => {
            const count = summary.distribution[stars - 1] ?? 0;
            return (
              <Link
                key={stars}
                href={filterHref({ rating: params.rating === stars ? undefined : stars })}
                className="flex items-center gap-2 text-xs hover:text-primary"
                aria-label={`${count} reviews with ${stars} stars`}
              >
                <span className="w-3 tabular-nums">{stars}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-border">
                  <span
                    className="block h-full rounded-full bg-chart-3"
                    style={{ width: `${(count / most) * 100}%` }}
                  />
                </span>
                <span className="w-6 text-right tabular-nums">{count}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <nav aria-label="Review views" className="flex gap-1 border-b">
        {[
          ['inbox', 'Reviews', '/reviews'],
          ['links', `Links and QR codes (${links.length})`, '/reviews?view=links'],
        ].map(([key, label, href]) => (
          <Link
            key={key}
            href={href ?? '/reviews'}
            aria-current={view === key ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground',
              view === key && 'border-primary font-medium text-foreground',
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {view === 'links' &&
        (links.length === 0 ? (
          <div className="rounded-xl border bg-card">
            <EmptyState
              icon={QrCode}
              title="No review links yet"
              description="Create one to get an address and a QR code. Put it on the counter, a receipt or a follow-up message."
            />
          </div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {links.map((link) => {
              const url = `${base}/r/${link.publicToken}`;
              const svg = qrSvg(url);
              return (
                <li key={link.id} className="flex gap-4 rounded-xl border bg-card p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG we generate; nothing to optimise */}
                  <img
                    src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
                    alt={`QR code for ${link.name}`}
                    className={cn(
                      'size-28 shrink-0 rounded-md border',
                      !link.isActive && 'opacity-30',
                    )}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div>
                      <p className="flex items-center gap-2 font-medium">
                        <span className="truncate">{link.name}</span>
                        {!link.isActive && <Badge variant="outline">Switched off</Badge>}
                      </p>
                      <p className="text-sm text-muted-foreground">“{link.prompt}”</p>
                      <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                        {link.reviews} {link.reviews === 1 ? 'review' : 'reviews'}
                        {link.average && ` · ${link.average} average`}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{url}</p>
                    </div>
                    {canManage && (
                      <ReviewLinkActions
                        link={{
                          id: link.id,
                          name: link.name,
                          prompt: link.prompt,
                          isActive: link.isActive,
                        }}
                        url={url}
                        qrSvg={svg}
                        businessName={ctx.tenant.name}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ))}

      {view === 'inbox' && (
        <>
          <div className="flex flex-wrap gap-1.5 text-sm">
            {(
              [
                [undefined, 'All'],
                ['new', 'New'],
                ['read', 'Read'],
                ['resolved', 'Followed up'],
              ] as const
            ).map(([status, label]) => (
              <Link
                key={label}
                href={filterHref({ status })}
                aria-current={params.status === status ? 'true' : undefined}
                className={cn(
                  'rounded-full border px-3 py-1 text-muted-foreground hover:text-foreground',
                  params.status === status &&
                    'border-primary bg-accent font-medium text-foreground',
                )}
              >
                {label}
              </Link>
            ))}
            {params.rating && (
              <Link
                href={filterHref({ rating: undefined })}
                className="rounded-full border px-3 py-1"
              >
                {params.rating} stars ✕
              </Link>
            )}
          </div>
          {reviews.length === 0 ? (
            <div className="rounded-xl border bg-card">
              <EmptyState
                icon={MessageSquareHeart}
                title="No reviews here yet"
                description={
                  links.length === 0
                    ? 'Create a review link first, then share it or print its QR code.'
                    : 'Reviews appear here as soon as a customer sends one.'
                }
              />
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {reviews.map((review) => (
                <li key={review.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Stars rating={review.rating} />
                    <p className="text-sm font-medium" data-sensitive>
                      {review.customerName ?? 'Anonymous'}
                    </p>
                    <Badge variant={review.status === 'new' ? 'default' : 'secondary'}>
                      {REVIEW_STATUS_LABELS[review.status]}
                    </Badge>
                    <p className="ml-auto text-xs text-muted-foreground">
                      {review.linkName} · {formatDateTime(ctx, review.createdAt)}
                    </p>
                  </div>
                  {review.comment && (
                    <p className="text-sm whitespace-pre-wrap">{review.comment}</p>
                  )}
                  {review.customerEmail && (
                    <p className="text-sm text-muted-foreground" data-sensitive>
                      {review.contactAllowed ? (
                        <>
                          Happy to be contacted:{' '}
                          <a
                            href={`mailto:${review.customerEmail}`}
                            className="underline underline-offset-4"
                          >
                            {review.customerEmail}
                          </a>
                        </>
                      ) : (
                        <>{review.customerEmail} · did not ask to be contacted</>
                      )}
                      {review.contactId && hasPermission(ctx, 'contacts.view') && (
                        <>
                          {' · '}
                          <Link
                            href={`/contacts/${review.contactId}`}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            Open their record
                          </Link>
                        </>
                      )}
                    </p>
                  )}
                  {canManage ? (
                    <ReviewHandling
                      id={review.id}
                      status={review.status}
                      internalNote={review.internalNote}
                    />
                  ) : (
                    review.internalNote && (
                      <p className="text-sm text-muted-foreground">Note: {review.internalNote}</p>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
