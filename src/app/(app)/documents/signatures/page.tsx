import { FileSignature } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { ListPagination } from '@/components/data/list-pagination';
import { PageHeader } from '@/components/data/page-header';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { RequestStatusBadge } from '@/modules/esign/components/status-badge';
import { listSignRequests } from '@/modules/esign/queries';
import { requestFiltersSchema } from '@/modules/esign/schemas';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Signature requests' };

const TABS = [
  { value: undefined, label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'sent', label: 'Out for signature' },
  { value: 'completed', label: 'Completed' },
  { value: 'declined', label: 'Declined' },
  { value: 'voided', label: 'Voided' },
] as const;

export default async function SignatureRequestsPage({
  searchParams,
}: PageProps<'/documents/signatures'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'files.request_signatures');
  const filters = requestFiltersSchema.parse(await searchParams);
  const { items, nextCursor } = await listSignRequests(ctx, filters);

  return (
    <div className="flex w-full max-w-5xl flex-col gap-5">
      <div>
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link href="/documents" className="underline-offset-4 hover:underline">
            Documents
          </Link>{' '}
          / Signatures
        </nav>
        <PageHeader
          title="Signature requests"
          description="PDFs sent out for electronic signature. Open a PDF in Documents and choose “Request signatures” to start one."
        />
      </div>

      <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
        {TABS.map((tab) => (
          <Link
            key={tab.label}
            href={tab.value ? `/documents/signatures?status=${tab.value}` : '/documents/signatures'}
            aria-current={filters.status === tab.value ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              filters.status === tab.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card hover:bg-muted',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="No signature requests here"
          description="Open a PDF in Documents and choose “Request signatures” to send it to the people who need to sign."
        />
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/documents/signatures/${item.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.documentName} ·{' '}
                    {item.status === 'draft'
                      ? `Started ${formatDate(ctx, item.createdAt)}`
                      : item.completedAt
                        ? `Completed ${formatDate(ctx, item.completedAt)}`
                        : `Sent ${formatDate(ctx, item.sentAt)}`}
                  </span>
                </span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {item.signedCount}/{item.signerCount} signed
                </span>
                <RequestStatusBadge status={item.status} expired={item.expired} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ListPagination
        pathname="/documents/signatures"
        filters={{ status: filters.status, cursor: filters.cursor }}
        nextCursor={nextCursor}
        shown={items.length}
      />
    </div>
  );
}
