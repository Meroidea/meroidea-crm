import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/data/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { AppError } from '@/lib/errors';
import { canAccess } from '@/lib/permissions/scope';
import { ContactForm } from '@/modules/contacts/components/contact-form';
import { assignableOwners } from '@/modules/contacts/owners';
import { getContact } from '@/modules/contacts/queries';
import { listActiveLeadSources } from '@/modules/lead-sources/queries';
import { listActiveMembers } from '@/modules/members/queries';
import { hasPermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Edit contact' };

export default async function EditContactPage({ params }: PageProps<'/contacts/[id]/edit'>) {
  const ctx = await requireTenantContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const contact = await getContact(ctx, id).catch((error: unknown) => {
    if (error instanceof AppError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN'))
      notFound();
    throw error;
  });
  if (!hasPermission(ctx, 'contacts.edit') || !canAccess(ctx, 'contacts.edit', contact)) notFound();

  const [members, sources] = await Promise.all([
    listActiveMembers(ctx),
    listActiveLeadSources(ctx),
  ]);
  const mayReassign =
    hasPermission(ctx, 'contacts.assign') && canAccess(ctx, 'contacts.assign', contact);
  const owners = mayReassign
    ? assignableOwners(ctx, members)
    : members
        .filter((member) => member.userId === contact.ownerUserId)
        .map((member) => ({ value: member.userId, label: member.fullName }));
  if (contact.ownerUserId === null) owners.unshift({ value: '', label: 'Unassigned' });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <PageHeader title={`Edit ${contact.fullName}`} />
      <Card>
        <CardContent>
          <ContactForm
            contactId={contact.id}
            label={ctx.tenant.labels.contact}
            owners={owners}
            sources={sources.map((source) => ({ value: source.id, label: source.name }))}
            canAssign={mayReassign && owners.length > 1}
            ownerHint={
              mayReassign ? undefined : 'Only someone who can reassign records can change this.'
            }
            canViewSensitive={contact.canViewSensitive}
            defaults={{
              firstName: contact.firstName,
              lastName: contact.lastName ?? '',
              email: contact.email ?? '',
              phone: contact.phone ?? '',
              altPhone: contact.altPhone ?? '',
              dateOfBirth: contact.dateOfBirth ?? '',
              gender: contact.gender ?? '',
              addressLine: contact.addressLine ?? '',
              city: contact.city ?? '',
              region: contact.region ?? '',
              country: contact.country ?? '',
              status: contact.status,
              ownerUserId: contact.ownerUserId ?? '',
              sourceId: contact.sourceId ?? '',
              marketingConsent: contact.marketingConsent,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
