import { FileSpreadsheet, ShieldCheck, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/data/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import { scopeDecision } from '@/lib/permissions/scope';
import { LEAD_TYPE_LABELS } from '@/modules/contacts/schemas';
import { ImportWizard } from '@/modules/imports/components/import-wizard';
import { listImportBatches } from '@/modules/imports/queries';
import { contactFormSetup } from '@/modules/leads/form-setup';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Imports' };

export default async function ImportsPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'contacts.import');
  const [setup, batches] = await Promise.all([contactFormSetup(ctx), listImportBatches(ctx)]);
  const label = ctx.tenant.labels.contact;

  return (
    <div className="flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Imports"
        description={`Upload leads or existing ${label.plural.toLowerCase()} from Excel or CSV.`}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          [
            FileSpreadsheet,
            'Map your columns',
            'Name, email, phone, company and your own fields — we suggest matches.',
          ],
          [
            ShieldCheck,
            'Duplicates handled',
            'Skip them, merge into the existing record, or create anyway.',
          ],
          [Users, 'Routed or yours', 'Leads go to you, the routing rules, or the queue.'],
        ].map(([Icon, title, body]) => {
          const I = Icon as typeof FileSpreadsheet;
          return (
            <div key={String(title)} className="flex gap-3 rounded-xl border bg-card p-4">
              <I aria-hidden className="size-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">{String(title)}</p>
                <p className="text-xs text-muted-foreground">{String(body)}</p>
              </div>
            </div>
          );
        })}
      </div>
      <Card>
        <CardContent>
          <ImportWizard
            sources={setup.sources}
            leadTypes={setup.leadTypes}
            customFields={setup.customFields
              .filter((field) => field.isActive)
              .map((field) => ({ key: field.key, label: field.label }))}
            contactLabel={label.singular}
            canMerge={hasPermission(ctx, 'contacts.edit')}
            canQueue={
              hasPermission(ctx, 'contacts.assign') &&
              scopeDecision(ctx, 'contacts.assign').kind === 'all'
            }
          />
        </CardContent>
      </Card>

      {batches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Earlier uploads</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <ul className="flex flex-col divide-y">
              {batches.map((batch) => (
                <li key={batch.id}>
                  <Link
                    href={`/imports/${batch.id}`}
                    className="flex flex-col gap-1 px-6 py-3 hover:bg-accent/40 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{batch.fileName}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(ctx, batch.createdAt)}
                        {batch.createdByName ? ` · ${batch.createdByName}` : ''}
                        {batch.asLeads
                          ? ` · Leads${batch.leadType ? `, ${LEAD_TYPE_LABELS[batch.leadType]}` : ''}`
                          : ''}
                        {batch.sourceName
                          ? ` · ${batch.sourceName}${batch.subSourceName ? ` – ${batch.subSourceName}` : ''}`
                          : ''}
                        {batch.campaignName ? ` · ${batch.campaignName}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {batch.createdCount + batch.duplicateCreatedCount} created ·{' '}
                      {batch.mergedCount} merged · {batch.skippedCount} skipped · {batch.errorCount}{' '}
                      problems
                      {!batch.completedAt && ' · unfinished'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
