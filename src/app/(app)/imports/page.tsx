import { FileSpreadsheet, ShieldCheck, Users } from 'lucide-react';
import type { Metadata } from 'next';

import { PageHeader } from '@/components/data/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { ImportWizard } from '@/modules/imports/components/import-wizard';
import { listActiveLeadSources } from '@/modules/lead-sources/queries';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Imports' };

export default async function ImportsPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'contacts.import');
  const sources = await listActiveLeadSources(ctx);
  const label = ctx.tenant.labels.contact;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="Imports"
        description={`Bring your existing ${label.plural.toLowerCase()} in from a spreadsheet.`}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          [
            FileSpreadsheet,
            'Map your columns',
            'Name, email, phone, city, country — we suggest matches.',
          ],
          [ShieldCheck, 'Duplicates checked', 'Against your workspace and within the file itself.'],
          [Users, 'Owned by you', 'Imported records are assigned to you; reassign any time.'],
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
            sources={sources.map((source) => ({ value: source.id, label: source.name }))}
            contactLabel={label.singular}
          />
        </CardContent>
      </Card>
    </div>
  );
}
