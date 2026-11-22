import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/data/page-header';
import { SlaSettingsForm } from '@/modules/helpdesk/components/sla-settings-form';
import { getSlaSettings, helpdeskAssignees } from '@/modules/helpdesk/queries';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Response targets' };

/** The business's SLA policy (ADR-069): targets by priority and the hours they count in. */
export default async function ResponseTargetsPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'tickets.manage');
  const [settings, people] = await Promise.all([getSlaSettings(ctx), helpdeskAssignees(ctx)]);
  const timezones = Intl.supportedValuesOf('timeZone');
  if (!timezones.includes(settings.timezone)) timezones.unshift(settings.timezone);
  return (
    <div className="flex w-full max-w-3xl flex-col gap-5">
      <Link
        href="/helpdesk"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> Helpdesk
      </Link>
      <PageHeader
        title="Response targets"
        description="How quickly tickets should get a first reply and be solved, by priority. Tickets show On track, At risk or Breached against these, and people are told when one is at risk or missed."
      />
      <SlaSettingsForm settings={settings} people={people} timezones={timezones} />
    </div>
  );
}
