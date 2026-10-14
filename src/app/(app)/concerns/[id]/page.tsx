import { ArrowLeft, Lock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ConcernReply, ConcernStatusControls } from '@/modules/concerns/components/concern-tools';
import { getConcern } from '@/modules/concerns/queries';
import { CONCERN_CATEGORIES, CONCERN_STATUS_LABELS } from '@/modules/concerns/schemas';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Concern' };

const STATUS_VARIANT = { open: 'outline', in_progress: 'secondary', resolved: 'default' } as const;

export default async function ConcernPage({ params }: PageProps<'/concerns/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'concerns.raise');
  const parsed = z.object({ id: z.uuid() }).safeParse(await params);
  const concern = parsed.success ? await getConcern(ctx, parsed.data.id) : null;
  if (!concern) notFound();
  const mine = concern.raisedBy === ctx.userId;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Link
        href={mine ? '/concerns?view=mine' : '/concerns'}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> All concerns
      </Link>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{concern.subject}</h1>
          <Badge variant={STATUS_VARIANT[concern.status]}>
            {CONCERN_STATUS_LABELS[concern.status]}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {CONCERN_CATEGORIES[concern.category]} · raised by{' '}
          <span data-sensitive>{mine ? 'you' : concern.raisedByName}</span> on{' '}
          {formatDateTime(ctx, concern.createdAt)}
        </p>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Lock aria-hidden className="size-3.5" />
          {concern.raisedWith === 'admin'
            ? 'Raised with the admin only: managers cannot see it.'
            : 'Raised with a manager: managers and the admin can see it.'}
        </p>
        {concern.canHandle && (
          <div className="mt-1">
            <ConcernStatusControls concernId={concern.id} status={concern.status} />
          </div>
        )}
      </header>

      <ol className="flex flex-col gap-3">
        {concern.messages.map((message) => {
          const own = message.authorUserId === ctx.userId;
          return (
            <li
              key={message.id}
              className={cn(
                'rounded-xl border p-4',
                message.authorUserId === concern.raisedBy ? 'bg-card' : 'bg-accent/50',
              )}
            >
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground" data-sensitive>
                  {own ? 'You' : message.authorName}
                </span>{' '}
                · {formatDateTime(ctx, message.createdAt)}
              </p>
              <p className="mt-2 text-sm whitespace-pre-wrap" data-sensitive>
                {message.body}
              </p>
            </li>
          );
        })}
      </ol>

      {concern.status === 'resolved' ? (
        <p className="rounded-xl border bg-muted/50 p-4 text-sm text-muted-foreground">
          Resolved on {formatDateTime(ctx, concern.resolvedAt)}.{' '}
          {concern.canHandle
            ? 'Reopen it to reply.'
            : 'If it is not sorted, raise a new concern or ask for this one to be reopened.'}
        </p>
      ) : (
        <ConcernReply concernId={concern.id} />
      )}
    </div>
  );
}
