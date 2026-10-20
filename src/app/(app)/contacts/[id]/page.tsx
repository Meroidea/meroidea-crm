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
import { PossibleDuplicates } from '@/modules/contacts/components/possible-duplicates';
import { getContact, listPossibleDuplicates } from '@/modules/contacts/queries';
import { ActivityComposer } from '@/modules/activities/components/activity-composer';
import { Timeline } from '@/modules/activities/components/timeline';
import { getTimeline } from '@/modules/activities/queries';
import { StageBadge } from '@/modules/opportunities/components/stage-badge';
import { listOpportunitiesForContact } from '@/modules/opportunities/queries';
import { TaskList } from '@/modules/tasks/components/task-list';
import { TaskQuickAdd } from '@/modules/tasks/components/task-quick-add';
import { listTasksFor } from '@/modules/tasks/queries';
import { formatMoney } from '@/lib/format';
import { getCustomFields } from '@/modules/custom-fields/queries';
import { displayCustomValue } from '@/modules/custom-fields/validation';
import { HouseholdLinks } from '@/modules/leads/components/household-links';
import { LeadPanel } from '@/modules/leads/components/lead-panel';
import { getLeadConfig } from '@/modules/leads/config';
import { leadPanelData } from '@/modules/leads/panel-data';
import { getEmailTemplates, getSequences } from '@/modules/crm-config/queries';
import { listActiveMembers } from '@/modules/members/queries';
import { SendEmailButton, SequencePanel } from '@/modules/outreach/components/outreach-tools';
import { listEnrollments } from '@/modules/outreach/queries';
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
  const canManageTasks = hasPermission(ctx, 'tasks.manage');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const contact = await loadContact(ctx, id);
  const labels = ctx.tenant.labels;
  const canEdit = hasPermission(ctx, 'contacts.edit') && canAccess(ctx, 'contacts.edit', contact);
  const canDelete =
    hasPermission(ctx, 'contacts.delete') && canAccess(ctx, 'contacts.delete', contact);
  const [
    opportunities,
    timeline,
    tasks,
    leadPanel,
    customFields,
    leadConfig,
    templates,
    sequenceOptions,
    enrollments,
    members,
    duplicates,
  ] = await Promise.all([
    hasPermission(ctx, 'opportunities.view')
      ? listOpportunitiesForContact(ctx, contact.id)
      : Promise.resolve([]),
    getTimeline(ctx, { contactId: contact.id }),
    listTasksFor(ctx, { contactId: contact.id }),
    leadPanelData(ctx, contact),
    getCustomFields(ctx, 'contact'),
    getLeadConfig(ctx),
    hasPermission(ctx, 'activities.create') ? getEmailTemplates(ctx, true) : Promise.resolve([]),
    hasPermission(ctx, 'tasks.manage') ? getSequences(ctx, true) : Promise.resolve([]),
    listEnrollments(ctx, contact.id),
    hasPermission(ctx, 'tasks.assign_others') ? listActiveMembers(ctx) : Promise.resolve([]),
    canEdit ? listPossibleDuplicates(ctx, contact) : Promise.resolve([]),
  ]);
  const canEmail =
    hasPermission(ctx, 'activities.create') &&
    Boolean(contact.email) &&
    !contact.doNotEmail &&
    contact.status !== 'do_not_contact' &&
    !contact.anonymizedAt;
  const shownCustom = customFields.filter(
    (field) => field.isActive || contact.customFields[field.key] !== undefined,
  );
  const showHousehold = contact.lead?.type === 'b2c' || contact.household.length > 0;
  const hasCompany = [
    contact.companyName,
    contact.jobTitle,
    contact.companyWebsite,
    contact.linkedinUrl,
    contact.industry,
    contact.companySize,
  ].some(Boolean);
  const websiteHref = contact.companyWebsite
    ? /^https?:\/\//i.test(contact.companyWebsite)
      ? contact.companyWebsite
      : `https://${contact.companyWebsite}`
    : null;
  const address = [contact.addressLine, contact.city, contact.region, contact.country]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="flex w-full max-w-6xl flex-col gap-5">
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
            {contact.sourceName &&
              ` · via ${contact.sourceName}${contact.subSourceName ? ` – ${contact.subSourceName}` : ''}`}{' '}
            · added {formatDate(ctx, contact.createdAt)}
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {canEmail && contact.email && (
            <SendEmailButton contactId={contact.id} to={contact.email} templates={templates} />
          )}
          {!canEmail && contact.email && !contact.doNotEmail && (
            <Button asChild variant="outline" className="flex-1 sm:flex-none">
              <a href={`mailto:${contact.email}`}>
                <Mail aria-hidden /> Email
              </a>
            </Button>
          )}
          {contact.phone && !contact.doNotCall && (
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
            canErase={hasPermission(ctx, 'contacts.anonymize') && !contact.anonymizedAt}
          />
        </div>
      </header>

      {contact.anonymizedAt && (
        <p role="note" className="rounded-lg border bg-muted px-4 py-3 text-sm">
          This person’s details were erased on request on {formatDate(ctx, contact.anonymizedAt)}.
          Their history is kept without them.
        </p>
      )}

      {contact.status !== 'do_not_contact' && (contact.doNotEmail || contact.doNotCall) && (
        <p
          role="note"
          className="rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-text"
        >
          Asked us{' '}
          <strong>
            {[contact.doNotEmail && 'not to email', contact.doNotCall && 'not to call']
              .filter(Boolean)
              .join(' and ')}
          </strong>
          .
        </p>
      )}

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
                  {contact.consentSource && ` via ${contact.consentSource}`}
                  {contact.consentUpdatedAt && (
                    <span className="text-muted-foreground">
                      {' '}
                      · {formatDate(ctx, contact.consentUpdatedAt)}
                    </span>
                  )}
                </Detail>
                <Detail label="Preferred language">{contact.language ?? '—'}</Detail>
                <Detail label="Source">
                  {contact.sourceName
                    ? `${contact.sourceName}${contact.subSourceName ? ` – ${contact.subSourceName}` : ''}`
                    : '—'}
                </Detail>
                <Detail label="Campaign or event">{contact.campaignName ?? '—'}</Detail>
                <Detail label="Interested in">{contact.interest ?? '—'}</Detail>
                {contact.utm && Object.keys(contact.utm).length > 0 && (
                  <Detail label="Web tracking (UTM)">
                    {Object.entries(contact.utm)
                      .map(([key, value]) => `${key.replace('utm_', '')}: ${value}`)
                      .join(' · ')}
                  </Detail>
                )}
                <Detail label="Last activity">{formatDateTime(ctx, contact.lastActivityAt)}</Detail>
              </dl>
            </CardContent>
          </Card>
          {(hasCompany || contact.lead?.type === 'b2b') && (
            <Card>
              <CardHeader>
                <CardTitle>Company</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  <Detail label="Company">{contact.companyName ?? '—'}</Detail>
                  <Detail label="Job title">{contact.jobTitle ?? '—'}</Detail>
                  <Detail label="Website">
                    {websiteHref ? (
                      <a
                        href={websiteHref}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-primary hover:underline"
                      >
                        {contact.companyWebsite}
                      </a>
                    ) : (
                      '—'
                    )}
                  </Detail>
                  <Detail label="LinkedIn">
                    {contact.linkedinUrl ? (
                      <a
                        href={contact.linkedinUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-primary hover:underline"
                      >
                        Profile
                      </a>
                    ) : (
                      '—'
                    )}
                  </Detail>
                  <Detail label="Industry">{contact.industry ?? '—'}</Detail>
                  <Detail label="Company size">{contact.companySize ?? '—'}</Detail>
                </dl>
              </CardContent>
            </Card>
          )}
          {shownCustom.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>More details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  {shownCustom.map((field) => (
                    <Detail key={field.id} label={field.label}>
                      {displayCustomValue(field, contact.customFields[field.key])}
                    </Detail>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}
          {hasPermission(ctx, 'activities.create') && (
            <ActivityComposer
              contactId={contact.id}
              callOutcomes={leadConfig.settings.callOutcomes}
            />
          )}
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
          {leadPanel && <LeadPanel {...leadPanel} />}
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
                  canManage={canManageTasks}
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
                canPick={hasPermission(ctx, 'organizations.view')}
                canEdit={canEdit}
                organizationLabel={labels.organization.singular}
              />
            </CardContent>
          </Card>
          {(enrollments.length > 0 || (canEdit && sequenceOptions.length > 0)) && (
            <Card>
              <CardHeader>
                <CardTitle>Sequences</CardTitle>
              </CardHeader>
              <CardContent>
                <SequencePanel
                  contactId={contact.id}
                  enrollments={enrollments}
                  sequences={sequenceOptions.map((sequence) => ({
                    value: sequence.id,
                    label: sequence.name,
                  }))}
                  people={members.map((member) => ({
                    value: member.userId,
                    label: member.fullName,
                  }))}
                  canManage={canEdit && hasPermission(ctx, 'tasks.manage')}
                />
              </CardContent>
            </Card>
          )}
          {showHousehold && (
            <Card>
              <CardHeader>
                <CardTitle>Household or group</CardTitle>
              </CardHeader>
              <CardContent>
                <HouseholdLinks
                  contactId={contact.id}
                  links={contact.household}
                  relationships={leadConfig.settings.householdRelationships}
                  canEdit={canEdit}
                />
              </CardContent>
            </Card>
          )}
          {duplicates.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Possible duplicates</CardTitle>
              </CardHeader>
              <CardContent>
                <PossibleDuplicates
                  contactId={contact.id}
                  recordName={contact.fullName}
                  duplicates={duplicates}
                  canMerge={hasPermission(ctx, 'contacts.merge')}
                />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Record</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3">
                <Detail label="Created">
                  {formatDateTime(ctx, contact.createdAt)}
                  {contact.createdByName && ` by ${contact.createdByName}`}
                  {contact.importBatch &&
                    (hasPermission(ctx, 'contacts.import') ? (
                      <>
                        {' · '}
                        <Link
                          href={`/imports/${contact.importBatch.id}`}
                          className="text-primary hover:underline"
                        >
                          upload {contact.importBatch.fileName}
                        </Link>
                      </>
                    ) : (
                      ` · upload ${contact.importBatch.fileName}`
                    ))}
                </Detail>
                <Detail label="Last updated">{formatDateTime(ctx, contact.updatedAt)}</Detail>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
