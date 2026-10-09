import { ArrowLeft, Building2, Globe, Mail, Pencil, Phone } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AppError } from '@/lib/errors';
import { formatDateTime, initials } from '@/lib/format';
import { OrganizationActions } from '@/modules/organizations/components/organization-actions';
import { getOrganization } from '@/modules/organizations/queries';
import { hasPermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Organization' };

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

export default async function OrganizationPage({ params }: PageProps<'/organizations/[id]'>) {
  const ctx = await requireTenantContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const org = await getOrganization(ctx, id).catch((error: unknown) => {
    if (error instanceof AppError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN'))
      notFound();
    throw error;
  });
  const labels = ctx.tenant.labels;
  const canManage = hasPermission(ctx, 'organizations.manage');
  const address = [org.addressLine, org.city, org.region, org.country].filter(Boolean).join(', ');

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <Link
        href="/organizations"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> {labels.organization.plural}
      </Link>

      <header className="flex flex-wrap items-start gap-4">
        <span
          aria-hidden
          className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"
        >
          <Building2 className="size-6" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{org.name}</h1>
            {org.type && (
              <Badge variant="outline" className="capitalize">
                {org.type}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {org.contacts.length + org.hiddenContactCount} linked{' '}
            {labels.contact.plural.toLowerCase()}
            {address && ` · ${address}`}
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {org.website && (
            <Button asChild variant="outline" className="flex-1 sm:flex-none">
              <a href={org.website} target="_blank" rel="noopener noreferrer">
                <Globe aria-hidden /> Website
              </a>
            </Button>
          )}
          {canManage && (
            <>
              <Button asChild className="flex-1 sm:flex-none">
                <Link href={`/organizations/${org.id}/edit`}>
                  <Pencil aria-hidden /> Edit
                </Link>
              </Button>
              <OrganizationActions organizationId={org.id} recordName={org.name} />
            </>
          )}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4">
              <Detail label="Email">
                {org.email ? (
                  <a
                    href={`mailto:${org.email}`}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <Mail aria-hidden className="size-3.5" /> {org.email}
                  </a>
                ) : (
                  '—'
                )}
              </Detail>
              <Detail label="Phone">
                {org.phone ? (
                  <a
                    href={`tel:${org.phone.replace(/[^\d+]/g, '')}`}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <Phone aria-hidden className="size-3.5" /> {org.phone}
                  </a>
                ) : (
                  '—'
                )}
              </Detail>
              <Detail label="Address">{address || '—'}</Detail>
              <Detail label="Last updated">{formatDateTime(ctx, org.updatedAt)}</Detail>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{labels.contact.plural}</CardTitle>
            <CardDescription>
              People linked here. Link someone from their {labels.contact.singular.toLowerCase()}{' '}
              page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {org.contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {org.hiddenContactCount > 0 ? 'None that you can see.' : 'Nobody linked yet.'}
              </p>
            ) : (
              <ul className="flex flex-col divide-y">
                {org.contacts.map((person) => (
                  <li key={person.linkId}>
                    <Link
                      href={`/contacts/${person.contactId}`}
                      className="flex items-center gap-3 py-2.5 hover:text-primary"
                    >
                      <span
                        aria-hidden
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
                      >
                        {initials(person.fullName)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{person.fullName}</span>
                        <span
                          data-sensitive
                          className="block truncate text-xs text-muted-foreground"
                        >
                          {person.email ?? 'No email'}
                        </span>
                      </span>
                      <Badge variant="secondary" className="capitalize">
                        {person.relationship}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {org.hiddenContactCount > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                {org.hiddenContactCount} more belong to colleagues outside your access.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
