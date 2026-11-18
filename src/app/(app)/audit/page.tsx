import { ExternalLink, History, ScrollText, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { ListPagination } from '@/components/data/list-pagination';
import { PageHeader } from '@/components/data/page-header';
import { withParams } from '@/components/data/url';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import { AuditFilters } from '@/modules/audit/components/audit-filters';
import { ExportAuditButton } from '@/modules/audit/components/export-audit-button';
import {
  actionLabel,
  actorLabel,
  changeLines,
  detailLines,
  entityLabel,
  recordHref,
} from '@/modules/audit/format';
import { getAuditFacets, listAuditEntries } from '@/modules/audit/queries';
import { AUDIT_ACTIONS, auditFiltersSchema } from '@/modules/audit/schemas';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Audit log' };

const linkClass =
  'inline-flex items-center gap-1 rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50';

export default async function AuditPage({ searchParams }: PageProps<'/audit'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'audit.view');
  const filters = auditFiltersSchema.parse(await searchParams);
  const [{ entries, nextCursor }, facets] = await Promise.all([
    listAuditEntries(ctx, filters),
    getAuditFacets(ctx),
  ]);

  const labels = ctx.tenant.labels;
  const current = {
    from: filters.from,
    to: filters.to,
    person: filters.person,
    action: filters.action,
    type: filters.type,
    record: filters.record,
  };
  const filtered = Object.values(current).some(Boolean);
  const typeOptions = facets.types
    .map((type) => ({ value: type, label: entityLabel(type, labels) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Audit log"
        description="Who changed what in this workspace, and when. Entries cannot be edited or removed."
        actions={<ExportAuditButton filters={current} />}
      />

      <AuditFilters
        filters={current}
        people={facets.people.map((person) => ({ value: person.userId, label: person.name }))}
        actions={AUDIT_ACTIONS.map((action) => ({ value: action, label: actionLabel(action) }))}
        types={typeOptions}
      />

      {filters.record && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <History aria-hidden className="size-4 text-muted-foreground" />
          Showing the history of one{' '}
          {filters.type ? entityLabel(filters.type, labels).toLowerCase() : 'record'}.
          <Link href={withParams('/audit', current, { record: undefined })} className={linkClass}>
            <X aria-hidden className="size-3.5" /> Show all
          </Link>
        </p>
      )}

      <Card className="gap-0 py-0">
        {entries.length === 0 ? (
          <CardContent>
            <EmptyState
              icon={ScrollText}
              title={filtered ? 'Nothing matches' : 'Nothing recorded yet'}
              description={
                filtered
                  ? 'Try other dates, another person or a different action.'
                  : 'Changes people make in the workspace appear here as they happen.'
              }
            />
          </CardContent>
        ) : (
          <ul className="divide-y">
            {entries.map((entry) => {
              const changes = changeLines(entry.changes);
              const details = detailLines(entry.context);
              const href = recordHref(entry.entityType, entry.entityId);
              return (
                <li key={entry.id} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <Badge variant="secondary">{actionLabel(entry.action)}</Badge>
                      <span className="font-medium">{entityLabel(entry.entityType, labels)}</span>
                      <span className="text-muted-foreground">by {actorLabel(entry)}</span>
                    </p>
                    <time
                      dateTime={entry.createdAt.toISOString()}
                      className="text-xs text-muted-foreground tabular-nums"
                    >
                      {formatDateTime(ctx, entry.createdAt)}
                    </time>
                  </div>

                  {changes.length > 0 && (
                    <dl className="grid gap-1 text-sm">
                      {changes.map((change) => (
                        <div key={change.field} className="flex flex-wrap gap-x-2">
                          <dt className="text-muted-foreground">{change.field}</dt>
                          <dd className="min-w-0 break-words">
                            <span className="text-muted-foreground line-through decoration-1">
                              {change.before}
                            </span>{' '}
                            → {change.after}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  <div className="flex flex-wrap items-start gap-x-4 gap-y-1 text-xs">
                    {href && (
                      <Link href={href} className={linkClass}>
                        <ExternalLink aria-hidden className="size-3.5" /> Open record
                      </Link>
                    )}
                    {entry.entityId && !filters.record && (
                      <Link
                        href={withParams(
                          '/audit',
                          {},
                          {
                            record: entry.entityId,
                            type: entry.entityType,
                          },
                        )}
                        className={linkClass}
                      >
                        <History aria-hidden className="size-3.5" /> History of this record
                      </Link>
                    )}
                    {(details.length > 0 || entry.ip || entry.userAgent) && (
                      <details className="group w-full">
                        <summary className="cursor-pointer text-muted-foreground select-none">
                          More details
                        </summary>
                        <dl className="mt-1 grid gap-1 rounded-md bg-muted/40 px-3 py-2">
                          {details.map((detail) => (
                            <div key={detail.label} className="flex flex-wrap gap-x-2">
                              <dt className="text-muted-foreground">{detail.label}</dt>
                              <dd className="min-w-0 break-all">{detail.value}</dd>
                            </div>
                          ))}
                          {entry.ip && (
                            <div className="flex flex-wrap gap-x-2">
                              <dt className="text-muted-foreground">IP address</dt>
                              <dd>{entry.ip}</dd>
                            </div>
                          )}
                          {entry.userAgent && (
                            <div className="flex flex-wrap gap-x-2">
                              <dt className="text-muted-foreground">Browser</dt>
                              <dd className="min-w-0 break-all">{entry.userAgent}</dd>
                            </div>
                          )}
                        </dl>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <ListPagination
          pathname="/audit"
          filters={{ ...current, cursor: filters.cursor }}
          nextCursor={nextCursor}
          shown={entries.length}
        />
      </Card>
    </div>
  );
}
