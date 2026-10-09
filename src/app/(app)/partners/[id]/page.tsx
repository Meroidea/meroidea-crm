import { ArrowLeft, Building2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AppError } from '@/lib/errors';
import { PartnerTerms } from '@/modules/partners/components/partner-terms';
import { getPartner } from '@/modules/partners/queries';
import { PARTNER_STATUS_LABELS } from '@/modules/partners/schemas';
import { hasPermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Partner' };

export default async function PartnerPage({ params }: PageProps<'/partners/[id]'>) {
  const ctx = await requireTenantContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const partner = await getPartner(ctx, id).catch((error: unknown) => {
    if (error instanceof AppError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN'))
      notFound();
    throw error;
  });
  const labels = ctx.tenant.labels;
  const rate = partner.referred > 0 ? Math.round((partner.won / partner.referred) * 100) : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <Link
        href="/partners"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> {labels.partner.plural}
      </Link>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{partner.name}</h1>
        <Badge variant={partner.status === 'active' ? 'secondary' : 'outline'}>
          {PARTNER_STATUS_LABELS[partner.status]}
        </Badge>
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <Link href={`/organizations/${partner.organizationId}`}>
            <Building2 aria-hidden /> {labels.organization.singular} record
          </Link>
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ['Referred', String(partner.referred)],
          ['Open', String(partner.open)],
          ['Won', String(partner.won)],
          ['Conversion', rate === null ? '—' : `${rate}%`],
        ].map(([term, value]) => (
          <Card key={term} className="gap-1 py-4">
            <CardContent className="px-4">
              <p className="text-xs text-muted-foreground">{term}</p>
              <p className="text-2xl font-semibold text-primary tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Referral terms</CardTitle>
          <CardDescription>
            {hasPermission(ctx, 'partners.manage')
              ? 'What this partner earns. The commission ledger arrives in Phase 2.'
              : 'Only people who manage partners can change these.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasPermission(ctx, 'partners.manage') && partner.commissionType !== null ? (
            <PartnerTerms
              initial={{
                id: partner.id,
                status: partner.status,
                commissionType: partner.commissionType,
                commissionValue: partner.commissionValue ?? '',
                notes: partner.notes ?? '',
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{partner.notes ?? 'No notes.'}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
