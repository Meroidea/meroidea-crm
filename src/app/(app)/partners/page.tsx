import { Handshake, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatMoney } from '@/lib/format';
import { listPartners } from '@/modules/partners/queries';
import { PARTNER_STATUS_LABELS } from '@/modules/partners/schemas';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Partners' };

export default async function PartnersPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'partners.view');
  const partners = await listPartners(ctx);
  const label = ctx.tenant.labels.partner;
  const canManage = hasPermission(ctx, 'partners.manage');
  const addButton = canManage && (
    <Button asChild>
      <Link href="/partners/new">
        <Plus aria-hidden /> Add {label.singular.toLowerCase()}
      </Link>
    </Button>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <PageHeader
        title={label.plural}
        description="The organisations that refer business to you, and how it converts."
        actions={addButton}
      />
      {partners.length === 0 ? (
        <Card>
          <EmptyState
            icon={Handshake}
            title={`No ${label.plural.toLowerCase()} yet`}
            description={`Add the ${label.plural.toLowerCase()} who send you work, then tag new ${ctx.tenant.labels.opportunity.plural.toLowerCase()} with them to see who converts best.`}
            action={addButton}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {partners.map((partner) => {
            const rate =
              partner.won + partner.referred > 0 && partner.referred > 0
                ? Math.round((partner.won / partner.referred) * 100)
                : null;
            return (
              <Link
                key={partner.id}
                href={`/partners/${partner.id}`}
                className="rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <Card className="h-full transition-colors hover:border-primary/40">
                  <CardContent className="flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                          <Handshake aria-hidden className="size-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{partner.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {partner.commissionType === 'percentage' && partner.commissionValue
                              ? `${Number(partner.commissionValue)}% commission`
                              : partner.commissionType === 'fixed' && partner.commissionValue
                                ? `${formatMoney(partner.commissionValue, ctx.tenant.currency)} per win`
                                : partner.commissionType === null
                                  ? 'Terms hidden'
                                  : 'No commission'}
                          </p>
                        </div>
                      </div>
                      <Badge variant={partner.status === 'active' ? 'secondary' : 'outline'}>
                        {PARTNER_STATUS_LABELS[partner.status]}
                      </Badge>
                    </div>
                    <dl className="grid grid-cols-3 gap-2 text-center">
                      {[
                        ['Referred', partner.referred],
                        ['Open', partner.open],
                        ['Won', partner.won],
                      ].map(([term, value]) => (
                        <div key={String(term)} className="rounded-lg bg-muted/50 py-2">
                          <dt className="text-xs text-muted-foreground">{term}</dt>
                          <dd className="text-lg font-semibold tabular-nums">{value}</dd>
                        </div>
                      ))}
                    </dl>
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                        <span>Conversion</span>
                        <span>{rate === null ? '—' : `${rate}%`}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${rate ?? 0}%` }}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
