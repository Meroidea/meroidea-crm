import { MessageSquareWarning } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { RaiseConcernButton } from '@/modules/concerns/components/concern-tools';
import { canHandleConcerns, listConcerns } from '@/modules/concerns/queries';
import {
  CONCERN_CATEGORIES,
  CONCERN_STATUS_LABELS,
  RAISED_WITH_LABELS,
  concernViewSchema,
} from '@/modules/concerns/schemas';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Questions & concerns' };

const STATUS_VARIANT = {
  open: 'outline',
  in_progress: 'secondary',
  resolved: 'default',
} as const;

export default async function ConcernsPage({ searchParams }: PageProps<'/concerns'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'concerns.raise');
  const handles = canHandleConcerns(ctx);
  // Those who answer concerns land on what is waiting for them; everyone else on their own.
  const view = handles ? (concernViewSchema.parse(await searchParams).view ?? 'raised') : 'mine';
  const rows = await listConcerns(ctx, view);

  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <PageHeader
        title="Questions & concerns"
        description="Ask a manager or the admin about your pay, hours, shifts, leave or anything else, and keep the conversation in one place."
        actions={<RaiseConcernButton />}
      />

      {handles && (
        <nav aria-label="Concern views" className="flex gap-1 border-b">
          {[
            ['raised', 'Sent to you', '/concerns'],
            ['mine', 'Asked by you', '/concerns?view=mine'],
          ].map(([key, label, href]) => (
            <Link
              key={key}
              href={href ?? '/concerns'}
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
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={MessageSquareWarning}
            title={view === 'raised' ? 'No questions for you' : 'You have not asked anything yet'}
            description={
              view === 'raised'
                ? 'When someone asks a question you can answer, it appears here.'
                : 'Ask a question and you can follow the answer and its status here.'
            }
          />
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/concerns/${row.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <span className="min-w-0 flex-1 basis-56">
                  <span className="block truncate text-sm font-medium">{row.subject}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {view === 'raised' && <span data-sensitive>{row.raisedByName} · </span>}
                    {CONCERN_CATEGORIES[row.category]} · to{' '}
                    {RAISED_WITH_LABELS[row.raisedWith].toLowerCase()} ·{' '}
                    {formatDateTime(ctx, row.lastActivityAt)}
                  </span>
                </span>
                <Badge variant={STATUS_VARIANT[row.status]}>
                  {CONCERN_STATUS_LABELS[row.status]}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
