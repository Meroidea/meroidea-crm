import type { Metadata } from 'next';

import { PageHeader } from '@/components/data/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { ContactForm } from '@/modules/contacts/components/contact-form';
import { assignableOwners } from '@/modules/contacts/owners';
import { listActiveLeadSources } from '@/modules/lead-sources/queries';
import { listActiveMembers } from '@/modules/members/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'New contact' };

export default async function NewContactPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'contacts.create');
  const label = ctx.tenant.labels.contact;
  const [members, sources] = await Promise.all([
    listActiveMembers(ctx),
    listActiveLeadSources(ctx),
  ]);

  const owners = assignableOwners(ctx, members);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <PageHeader title={`New ${label.singular.toLowerCase()}`} />
      <Card>
        <CardContent>
          <ContactForm
            label={label}
            owners={owners}
            sources={sources.map((source) => ({ value: source.id, label: source.name }))}
            canAssign={owners.length > 1}
            ownerHint={
              hasPermission(ctx, 'contacts.assign')
                ? undefined
                : 'You can only own records yourself.'
            }
            canViewSensitive={hasPermission(ctx, 'contacts.view_sensitive')}
            defaults={{
              firstName: '',
              lastName: '',
              email: '',
              phone: '',
              altPhone: '',
              dateOfBirth: '',
              gender: '',
              addressLine: '',
              city: '',
              region: '',
              country: ctx.tenant.country ?? '',
              status: 'active',
              ownerUserId: ctx.userId,
              sourceId: '',
              marketingConsent: false,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
