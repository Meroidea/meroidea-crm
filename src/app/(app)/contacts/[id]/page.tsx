import { ArrowLeft, Mail, Pencil, Phone, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AppError } from '@/lib/errors';
import { formatCalendarDate, formatDate, formatDateTime, initials } from '@/lib/format';
import { canAccess } from '@/lib/permissions/scope';
import { ContactActions } from '@/modules/contacts/components/contact-actions';
import { ContactStatusBadge } from '@/modules/contacts/components/contact-status-badge';
import { OrganizationLinks } from '@/modules/contacts/components/organization-links';
import { getContact } from '@/modules/contacts/queries';
import { ActivityComposer } from '@/modules/activities/components/activity-composer';
import { Timeline } from '@/modules/activities/components/timeline';
import { getTimeline } from '@/modules/activities/queries';
import { StageBadge } from '@/modules/opportunities/components/stage-badge';
import { listOpportunitiesForContact } from '@/modules/opportunities/queries';
import { TaskList } from '@/modules/tasks/components/task-list';
import { TaskQuickAdd } from '@/modules/tasks/components/task-quick-add';
import { listTasksFor } from '@/modules/tasks/queries';
import { formatMoney } from '@/lib/format';
import { listOrganizationOptions } from '@/modules/organizations/queries';
import { hasPermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Contact' };

async function loadContact(ctx: Awaited<ReturnType<typeof requireTenantContext>>, id: string) {
  try {
    return await getContact(ctx, id);
  } catch (error) {
    if (error instanceof AppError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN'))
      notFound();
    throw error;
  }
}

function Detail({
  label,
  children,
  sensitive,
}: {
  label: string;
  children: ReactNode;
  sensitive?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words" data-sensitive={sensitive ? '' : undefined}>
        {children}
      </dd>
    </div>
  );
}

export default async function ContactPage({ params }: PageProps<'/contacts/[id]'>) {
  const ctx = await requireTenantContext();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const contact = await loadContact(ctx, id);
  const labels = ctx.tenant.labels;
  const canEdit = hasPermission(ctx, 'contacts.edit') && canAccess(ctx, 'contacts.edit', contact);
  const canDelete =
    hasPermission(ctx, 'contacts.delete') && canAccess(ctx, 'contacts.delete', contact);
  const [organizationOptions, opportunities, timeline, tasks] = await Promise.all([
    canEdit && hasPermission(ctx, 'organizations.view')
      ? listOrganizationOptions(ctx)
      : Promise.resolve([]),
    hasPermission(ctx, 'opportunities.view')
      ? listOpportunitiesForContact(ctx, contact.id)
      : Promise.resolve([]),
    getTimeline(ctx, { contactId: contact.id }),
    listTasksFor(ctx, { contactId: contact.id }),
  ]);
  const address = [contact.addressLine, contact.city, contact.region, contact.country]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <Link
        href="/contacts"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> {labels.contact.plural}
      </Link>

      <header className="flex flex-wrap items-start gap-4">
        <span
          aria-hidden
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground"
        >
          {initials(contact.fullName)}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{contact.fullName}</h1>
            <ContactStatusBadge status={contact.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {contact.ownerName
              ? `Owned by ${contact.ownerUserId === ctx.userId ? 'you' : contact.ownerName}`
              : 'Unassigned'}
            {contact.sourceName && ` · via ${contact.sourceName}`} · added{' '}
            {formatDate(ctx, contact.createdAt)}
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {contact.email && (
            <Button asChild variant="outline" className="flex-1 sm:flex-none">
              <a href={`mailto:${contact.email}`}>
                <Mail aria-hidden /> Email
              </a>
            </Button>
          )}
          {contact.phone && (
            <Button asChild variant="outline" className="flex-1 sm:flex-none">
              <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}>
                <Phone aria-hidden /> Call
              </a>
            </Button>
          )}
          {canEdit && (
            <Button asChild className="flex-1 sm:flex-none">
              <Link href={`/contacts/${contact.id}/edit`}>
                <Pencil aria-hidden /> Edit
              </Link>
            </Button>
          )}
          <ContactActions
            contactId={contact.id}
            recordName={contact.fullName}
            canDelete={canDelete}
          />
        </div>
      </header>

      {contact.status === 'do_not_contact' && (
        <p
          role="note"
          className="rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-text"
        >
          Marked <strong>do not contact</strong>. Don’t call, message or email this person.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <Detail label="Email" sensitive>
                  {contact.email ? (
                    <a href={`mailto:${contact.email}`} className="text-primary hover:underline">
                      {contact.email}
                    </a>
                  ) : (
                    '—'
                  )}
                </Detail>
                <Detail label="Phone" sensitive>
                  {contact.phone ?? '—'}
                </Detail>
                <Detail label="Other phone" sensitive>
                  {contact.altPhone ?? '—'}
                </Detail>
                <Detail label="Date of birth" sensitive={contact.canViewSensitive}>
                  {contact.canViewSensitive ? (
                    formatCalendarDate(contact.dateOfBirth)
                  ) : (
                    <span className="text-muted-foreground italic">Hidden for your role</span>
                  )}
                </Detail>
                <Detail label="Gender">{contact.gender ?? '—'}</Detail>
                <Detail label="Address" sensitive>
                  {address || '—'}
                </Detail>
                <Detail label="Marketing consent">
                  {contact.marketingConsent ? 'Agreed' : 'Not given'}
                  {contact.consentUpdatedAt && (
                    <span className="text-muted-foreground">
                      {' '}
                      · {formatDate(ctx, contact.consentUpdatedAt)}
                    </span>
                  )}
                </Detail>
                <Detail label="Last activity">{formatDateTime(ctx, contact.lastActivityAt)}</Detail>
              </dl>
            </CardContent>
          </Card>
          {hasPermission(ctx, 'activities.create') && <ActivityComposer contactId={contact.id} />}
          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <Timeline
                items={timeline}
                timezone={ctx.tenant.timezone}
                showRecord
                emptyText="No activity yet — log the first call or note above."
              />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          {hasPermission(ctx, 'opportunities.view') && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle>{labels.opportunity.plural}</CardTitle>
                {hasPermission(ctx, 'opportunities.create') && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/opportunities/new?contact=${contact.id}`}>
                      <Plus aria-hidden /> New
                    </Link>
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {opportunities.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None yet.</p>
                ) : (
                  <ul className="flex flex-col divide-y">
                    {opportunities.map((opportunity) => (
                      <li key={opportunity.id}>
                        <Link
                          href={`/opportunities/${opportunity.id}`}
                          className="flex flex-col gap-1 py-2.5 hover:text-primary"
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium">{opportunity.name}</span>
                            <span className="shrink-0 text-sm tabular-nums">
                              {opportunity.amount
                                ? formatMoney(
                                    opportunity.amount,
                                    opportunity.currency ?? ctx.tenant.currency,
                                    { compact: true },
                                  )
                                : ''}
                            </span>
                          </span>
                          <StageBadge name={opportunity.stageName} color={opportunity.stageColor} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
          {hasPermission(ctx, 'tasks.view') && (
            <Card>
              <CardHeader>
                <CardTitle>Next steps</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {hasPermission(ctx, 'tasks.manage') && (
                  <TaskQuickAdd contactId={contact.id} currentUserId={ctx.userId} />
                )}
                <TaskList
                  tasks={tasks}
                  timezone={ctx.tenant.timezone}
                  showRecord={false}
                  emptyText="No follow-up scheduled."
                />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>{labels.organization.plural}</CardTitle>
            </CardHeader>
            <CardContent>
              <OrganizationLinks
                contactId={contact.id}
                links={contact.organizations}
                options={organizationOptions}
                canEdit={canEdit}
                organizationLabel={labels.organization.singular}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Record</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3">
                <Detail label="Created">{formatDateTime(ctx, contact.createdAt)}</Detail>
                <Detail label="Last updated">{formatDateTime(ctx, contact.updatedAt)}</Detail>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
