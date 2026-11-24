import {
  Building,
  FileInput,
  Inbox,
  KanbanSquare,
  ListPlus,
  Mail,
  MessagesSquare,
  Radio,
  Route,
  ShieldCheck,
  Users,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/data/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { permissionAvailable } from '@/lib/features';
import { isScoped, PERMISSION_KEYS, ROLE_TEMPLATES } from '@/lib/permissions/catalog';
import { permissionGroups } from '@/lib/permissions/labels';
import { CrmSettingsForm } from '@/modules/crm-config/components/crm-settings-form';
import { CustomFieldsEditor, LabelsForm } from '@/modules/crm-config/components/fields-and-labels';
import { RolesEditor, WebFormsEditor } from '@/modules/crm-config/components/forms-and-roles';
import {
  ReasonsEditor,
  SourcesEditor,
  StatusesEditor,
} from '@/modules/crm-config/components/lead-lists-editor';
import { SequencesEditor, TemplatesEditor } from '@/modules/crm-config/components/outreach-editor';
import {
  ItemStageAdvanceList,
  PipelineList,
  StageRulesList,
} from '@/modules/crm-config/components/pipelines-editor';
import { RoutingEditor } from '@/modules/crm-config/components/routing-editor';
import {
  getEmailTemplates,
  getRolesWithGrants,
  getRoutingRules,
  getSequences,
  getTeams,
  getWebForms,
} from '@/modules/crm-config/queries';
import { getCustomFields } from '@/modules/custom-fields/queries';
import { getLeadConfig } from '@/modules/leads/config';
import { listActiveMembers } from '@/modules/members/queries';
import { getPipelineConfig, getPipelineSummaries } from '@/modules/pipelines/queries';
import { LostReasonList } from '@/modules/settings/components/settings-lists';
import { serverEnv } from '@/server/env';
import { StageEditor } from '@/modules/settings/components/stage-editor';
import { TeamTable } from '@/modules/settings/components/team-table';
import { readBusinessDetails } from '@/modules/settings/business';
import { ACCOUNT_STATUS_LABELS, PLATFORM_LABELS } from '@/modules/social/format';
import { listAccounts } from '@/modules/social/queries';
import { BusinessForm } from '@/modules/settings/components/business-form';
import { WorkspaceForm } from '@/modules/settings/components/workspace-form';
import { TradingHoursForm } from '@/modules/trading-hours/components/trading-hours-editor';
import { getTradingHours } from '@/modules/trading-hours/queries';
import { getAcceptedAgreement, getSettingsLists } from '@/modules/settings/queries';
import {
  hasFeature,
  hasPermission,
  requirePermission,
  requireTenantContext,
} from '@/server/context';

export const metadata: Metadata = { title: 'Settings' };

/** `crm` tabs configure the sales pipeline, so they only exist while that feature is on. */
const TABS: {
  key: string;
  label: string;
  icon: LucideIcon;
  crm?: true;
  roles?: true;
  /** Messaging channels: the social inbox's connected accounts (ADR-067). */
  social?: true;
}[] = [
  { key: 'general', label: 'Workspace', icon: Building },
  { key: 'leads', label: 'Leads', icon: Inbox, crm: true },
  { key: 'sources', label: 'Lead sources', icon: Radio, crm: true },
  { key: 'routing', label: 'Routing', icon: Route, crm: true },
  { key: 'pipeline', label: 'Pipelines', icon: KanbanSquare, crm: true },
  { key: 'lost', label: 'Lost reasons', icon: XCircle, crm: true },
  { key: 'fields', label: 'Fields and names', icon: ListPlus, crm: true },
  { key: 'outreach', label: 'Emails and sequences', icon: Mail, crm: true },
  { key: 'forms', label: 'Website forms', icon: FileInput, crm: true },
  { key: 'channels', label: 'Channels', icon: MessagesSquare, social: true },
  { key: 'team', label: 'Team', icon: Users },
  { key: 'roles', label: 'Roles', icon: ShieldCheck, roles: true },
];

export default async function SettingsPage({ searchParams }: PageProps<'/settings'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'settings.manage');
  const params = await searchParams;
  const crm = hasFeature(ctx, 'crm');
  const tabs = TABS.filter(
    (candidate) =>
      (crm || !candidate.crm) &&
      (!candidate.roles || hasPermission(ctx, 'roles.manage')) &&
      (!candidate.social || (hasFeature(ctx, 'social') && hasPermission(ctx, 'social.manage'))),
  );
  const tab = tabs.find((candidate) => candidate.key === params.tab)?.key ?? 'general';
  const pipelineParam = typeof params.pipeline === 'string' ? params.pipeline : null;
  const entityParam =
    params.entity === 'organization' ||
    params.entity === 'opportunity' ||
    params.entity === 'opportunity_item'
      ? params.entity
      : 'contact';
  const needsPeople = ['routing', 'pipeline'].includes(tab);
  const [lists, agreement, leadConfig, pipelines, itemPipelines, members, teams, tradingDays] =
    await Promise.all([
      getSettingsLists(ctx),
      getAcceptedAgreement(ctx),
      crm && ['leads', 'sources', 'routing'].includes(tab) ? getLeadConfig(ctx) : null,
      crm && tab === 'pipeline' ? getPipelineSummaries(ctx) : [],
      crm && tab === 'pipeline' ? getPipelineSummaries(ctx, 'opportunity_item') : [],
      needsPeople ? listActiveMembers(ctx) : [],
      needsPeople ? getTeams(ctx) : [],
      tab === 'general' ? getTradingHours(ctx) : [],
    ]);
  const selectedPipelineId =
    [...pipelines, ...itemPipelines].find((candidate) => candidate.id === pipelineParam)?.id ??
    pipelines.find((candidate) => candidate.isDefault)?.id ??
    null;
  const selectedIsItemPipeline = itemPipelines.some(
    (candidate) => candidate.id === selectedPipelineId,
  );
  const [pipeline, routingRules, customFields, templates, sequenceRows, webForms, roleRows] =
    await Promise.all([
      crm && tab === 'pipeline' && selectedPipelineId
        ? getPipelineConfig(ctx, selectedPipelineId, 'any')
        : null,
      crm && tab === 'routing' ? getRoutingRules(ctx) : [],
      crm && ['fields', 'pipeline', 'leads'].includes(tab)
        ? getCustomFields(
            ctx,
            tab === 'pipeline' ? 'opportunity' : tab === 'leads' ? 'contact' : entityParam,
          )
        : [],
      crm && tab === 'outreach' ? getEmailTemplates(ctx) : [],
      crm && tab === 'outreach' ? getSequences(ctx) : [],
      crm && tab === 'forms' ? getWebForms(ctx) : [],
      tab === 'roles' ? getRolesWithGrants(ctx) : [],
    ]);
  const people = members.map((member) => ({ value: member.userId, label: member.fullName }));
  // Where an item stage can move its opportunity: open and won stages of each active pipeline.
  const advanceTargets = selectedIsItemPipeline
    ? await Promise.all(
        pipelines
          .filter((candidate) => candidate.isActive)
          .map(async (candidate) => ({
            pipeline: candidate.name,
            stages: (await getPipelineConfig(ctx, candidate.id)).stages
              .filter((stage) => stage.isActive && stage.category !== 'lost')
              .map((stage) => ({ value: stage.id, label: stage.name })),
          })),
      )
    : [];
  const itemPipelineOptions = itemPipelines.map((candidate) => ({
    value: candidate.id,
    label: candidate.name,
  }));
  const teamOptions = teams.map((team) => ({ value: team.id, label: team.name }));
  const business = readBusinessDetails(ctx.tenant.settings);
  const channels = tab === 'channels' ? (await listAccounts(ctx)).accounts : [];

  return (
    <div className="flex w-full max-w-6xl flex-col gap-5">
      <PageHeader
        title="Settings"
        description="Shape the workspace around how your business works — no developer needed."
      />
      <div className="grid gap-5 md:grid-cols-[13rem_1fr]">
        <nav
          aria-label="Settings sections"
          className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:flex-col md:px-0"
        >
          {tabs.map(({ key, label, icon: Icon }) => (
            <Link
              key={key}
              href={`/settings?tab=${key}`}
              aria-current={tab === key ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                tab === key
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              <Icon aria-hidden className="size-4" /> {label}
            </Link>
          ))}
        </nav>

        <Card>
          {tab === 'general' && (
            <>
              <CardHeader>
                <CardTitle>Your business</CardTitle>
                <CardDescription>
                  Recorded by Meroidea when your business was set up, and printed on your payslips.
                  To change any of these, contact Meroidea.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid max-w-2xl gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
                  {(
                    [
                      ['Business name', ctx.tenant.name],
                      ['Legal name', ctx.tenant.legalName ?? 'Same as the business name'],
                      [
                        ctx.tenant.country === 'AU' ? 'ABN' : 'Business number',
                        ctx.tenant.businessNumber ?? '—',
                      ],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="contents">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {agreement && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {agreement.title} (version {agreement.version}) accepted by{' '}
                    {agreement.acceptedName} on {formatDateTime(ctx, agreement.acceptedAt)}.
                  </p>
                )}
              </CardContent>
              <CardHeader className="border-t pt-6">
                <CardTitle>Workspace</CardTitle>
                <CardDescription>Timezone and money defaults.</CardDescription>
              </CardHeader>
              <CardContent>
                <WorkspaceForm
                  initial={{
                    timezone: ctx.tenant.timezone,
                    currency: ctx.tenant.currency,
                    country: ctx.tenant.country ?? '',
                  }}
                />
              </CardContent>
              <CardHeader className="border-t pt-6">
                <CardTitle>Trading hours</CardTitle>
                <CardDescription>
                  When you are open and how many staff you need on. MeroAI builds rosters to cover
                  these hours, so it never has to ask when your day starts or ends.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TradingHoursForm days={tradingDays} />
              </CardContent>
              <CardHeader className="border-t pt-6">
                <CardTitle>Contact details</CardTitle>
                <CardDescription>
                  Printed on payslips made from now on. Payslips already made keep what they were
                  given.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BusinessForm
                  initial={{
                    address: business.address ?? '',
                    phone: business.phone ?? '',
                    email: business.email ?? '',
                    website: business.website ?? '',
                    payrollContact: business.payrollContact ?? '',
                  }}
                />
              </CardContent>
            </>
          )}
          {tab === 'leads' && leadConfig && (
            <>
              <CardHeader>
                <CardTitle>How you work leads</CardTitle>
                <CardDescription>
                  B2B, B2C or both; response times; what counts as a complete lead; your picklists.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CrmSettingsForm
                  initial={leadConfig.settings}
                  customFields={customFields.filter((field) => field.isActive)}
                />
              </CardContent>
              <CardHeader className="border-t pt-6">
                <CardTitle>Lead statuses</CardTitle>
                <CardDescription>
                  Rename, recolour and reorder them, and add your own working or closing statuses.
                  Those marked “used by the workflow” are set by handover and conversion.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <StatusesEditor statuses={leadConfig.statuses} />
              </CardContent>
              <CardHeader className="border-t pt-6">
                <CardTitle>Disqualification reasons</CardTitle>
                <CardDescription>
                  Asked when a lead is closed as not interested or disqualified.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ReasonsEditor
                  kind="disqualify"
                  reasons={leadConfig.reasons.filter((reason) => reason.kind === 'disqualify')}
                  placeholder="New reason, e.g. Wrong country"
                />
              </CardContent>
              <CardHeader className="border-t pt-6">
                <CardTitle>Handover rejection reasons</CardTitle>
                <CardDescription>
                  Asked when a sales rep returns a lead to the SDR/BDR.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ReasonsEditor
                  kind="reject"
                  reasons={leadConfig.reasons.filter((reason) => reason.kind === 'reject')}
                  placeholder="New reason, e.g. Timeline too far out"
                />
              </CardContent>
            </>
          )}
          {tab === 'sources' && leadConfig && (
            <>
              <CardHeader>
                <CardTitle>Lead sources and sub-sources</CardTitle>
                <CardDescription>
                  Every lead needs a source, and a sub-source when its source has any. Switched-off
                  entries keep their history and reports.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SourcesEditor sources={leadConfig.sources} />
              </CardContent>
            </>
          )}
          {tab === 'routing' && leadConfig && (
            <>
              <CardHeader>
                <CardTitle>Routing rules</CardTitle>
                <CardDescription>
                  Share new leads, and handovers to sales reps, automatically: in turn or by
                  workload, by source, region, industry, size, language or interest.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RoutingEditor
                  rules={routingRules}
                  people={people}
                  teams={teamOptions}
                  sources={leadConfig.sources.map((source) => ({
                    value: source.id,
                    label: source.name,
                  }))}
                  subSources={leadConfig.sources.flatMap((source) =>
                    source.subSources.map((sub) => ({
                      value: sub.id,
                      label: `${source.name} – ${sub.name}`,
                    })),
                  )}
                />
              </CardContent>
            </>
          )}
          {tab === 'pipeline' && (
            <>
              <CardHeader>
                <CardTitle>Pipelines</CardTitle>
                <CardDescription>
                  One per product line or deal type. Converted leads start in the pipeline set for
                  their type, or the default.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PipelineList
                  pipelines={pipelines}
                  selectedId={selectedPipelineId ?? ''}
                  itemPipelines={itemPipelineOptions}
                />
              </CardContent>
              <CardHeader className="border-t pt-6">
                <CardTitle>
                  Pipelines for {ctx.tenant.labels.opportunityItem.plural.toLowerCase()}
                </CardTitle>
                <CardDescription>
                  When one {ctx.tenant.labels.opportunity.singular.toLowerCase()} holds several{' '}
                  {ctx.tenant.labels.opportunityItem.plural.toLowerCase()} (applications to
                  different places, offers on different properties), each moves through its own
                  stages here. Rename what they are called under Fields and names.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PipelineList
                  kind="opportunity_item"
                  pipelines={itemPipelines}
                  selectedId={selectedPipelineId ?? ''}
                  addLabel={`Add a pipeline for ${ctx.tenant.labels.opportunityItem.plural.toLowerCase()}`}
                  placeholder="e.g. Applications"
                />
              </CardContent>
              {pipeline && (
                <>
                  <CardHeader className="border-t pt-6">
                    <CardTitle>{pipeline.name}: stages</CardTitle>
                    <CardDescription>
                      Rename and reorder stages, set win probability (drives the weighted forecast)
                      and how many quiet days make a deal “stale”. Hidden stages keep their history.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <StageEditor stages={pipeline.stages} pipelineId={pipeline.id} />
                  </CardContent>
                  {selectedIsItemPipeline ? (
                    <>
                      <CardHeader className="border-t pt-6">
                        <CardTitle>
                          {pipeline.name}: moving the{' '}
                          {ctx.tenant.labels.opportunity.singular.toLowerCase()} forward
                        </CardTitle>
                        <CardDescription>
                          {ctx.tenant.labels.opportunityItem.plural} entering a stage can move their{' '}
                          {ctx.tenant.labels.opportunity.singular.toLowerCase()} forward: never
                          back, and only through that stage’s own rules.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ItemStageAdvanceList
                          stages={pipeline.stages.filter((stage) => stage.isActive)}
                          targets={advanceTargets}
                          opportunityNoun={ctx.tenant.labels.opportunity.singular.toLowerCase()}
                        />
                      </CardContent>
                    </>
                  ) : (
                    <>
                      <CardHeader className="border-t pt-6">
                        <CardTitle>{pipeline.name}: stage owners and gates</CardTitle>
                        <CardDescription>
                          Who is responsible in each stage, what must be filled in or ticked off to
                          move on, and which moves need a manager’s approval.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <StageRulesList
                          stages={pipeline.stages.filter((stage) => stage.isActive)}
                          people={people}
                          teams={teamOptions}
                          customFields={customFields.filter((field) => field.isActive)}
                        />
                      </CardContent>
                    </>
                  )}
                </>
              )}
            </>
          )}
          {tab === 'fields' && (
            <>
              <CardHeader>
                <CardTitle>Your own fields</CardTitle>
                <CardDescription>
                  Add fields to people, organizations and opportunities: text, numbers, dates,
                  picklists, checkboxes and more. Switch one off to hide it without losing data.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <nav aria-label="Record type" className="flex flex-wrap gap-2">
                  {(['contact', 'organization', 'opportunity', 'opportunity_item'] as const).map(
                    (entity) => (
                      <Link
                        key={entity}
                        href={`/settings?tab=fields&entity=${entity}`}
                        aria-current={entityParam === entity ? 'page' : undefined}
                        className={cn(
                          'rounded-lg px-3 py-1.5 text-sm',
                          entityParam === entity
                            ? 'bg-accent font-medium'
                            : 'text-muted-foreground hover:bg-muted',
                        )}
                      >
                        {
                          ctx.tenant.labels[
                            entity === 'opportunity_item' ? 'opportunityItem' : entity
                          ].plural
                        }
                      </Link>
                    ),
                  )}
                </nav>
                <CustomFieldsEditor key={entityParam} entity={entityParam} fields={customFields} />
              </CardContent>
              <CardHeader className="border-t pt-6">
                <CardTitle>What you call things</CardTitle>
                <CardDescription>
                  Rename records to fit your business, e.g. Opportunity → Deal or Application,
                  Organization → Account or Company.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LabelsForm labels={ctx.tenant.labels} />
              </CardContent>
            </>
          )}
          {tab === 'outreach' && (
            <>
              <CardHeader>
                <CardTitle>Email templates</CardTitle>
                <CardDescription>
                  Reusable emails your team sends from a lead or contact. Replies go straight to the
                  sender’s own mailbox.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TemplatesEditor templates={templates} />
              </CardContent>
              <CardHeader className="border-t pt-6">
                <CardTitle>Sequences</CardTitle>
                <CardDescription>
                  A cadence of outreach steps. Enrolling a lead turns each step into a task on its
                  day for the person working it.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SequencesEditor
                  sequences={sequenceRows}
                  templates={templates
                    .filter((template) => template.isActive)
                    .map((template) => ({ value: template.id, label: template.name }))}
                />
              </CardContent>
            </>
          )}
          {tab === 'forms' && (
            <>
              <CardHeader>
                <CardTitle>Website forms</CardTitle>
                <CardDescription>
                  Build your own enquiry forms: choose the questions, add your own, preview them and
                  publish. Every answer lands on a new lead with its source, sub-source and web
                  tracking (UTM). Share the link or embed it on your website.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <WebFormsEditor forms={webForms} appUrl={serverEnv().APP_URL} />
              </CardContent>
            </>
          )}
          {tab === 'channels' && (
            <>
              <CardHeader>
                <CardTitle>Channels</CardTitle>
                <CardDescription>
                  The WhatsApp numbers and Facebook, Instagram and TikTok accounts whose messages
                  arrive in the social inbox, and whether each is working. Meroidea receives their
                  messages itself: there is nothing to set up with Meta or TikTok here.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {channels.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No accounts connected yet.</p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {channels.map((channel) => (
                      <li
                        key={channel.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                      >
                        <span className="min-w-0">
                          <span className="font-medium">{channel.name}</span>{' '}
                          <span className="text-sm text-muted-foreground">
                            {PLATFORM_LABELS[channel.platform]}
                          </span>
                          {channel.lastError && (
                            <span className="block text-sm text-destructive-text">
                              {channel.lastError}
                            </span>
                          )}
                        </span>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-xs font-medium',
                            channel.status === 'active'
                              ? 'bg-accent text-foreground'
                              : 'bg-destructive/10 text-destructive-text',
                          )}
                        >
                          {ACCOUNT_STATUS_LABELS[channel.status] ?? channel.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap gap-2">
                  <Link
                    href="/social/accounts"
                    className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80"
                  >
                    Connect or manage accounts
                  </Link>
                  {channels.some((channel) => channel.platform === 'whatsapp') && (
                    <Link
                      href="/social/templates"
                      className="inline-flex h-9 items-center rounded-lg border px-3 text-sm font-medium hover:bg-muted"
                    >
                      WhatsApp templates
                    </Link>
                  )}
                </div>
              </CardContent>
            </>
          )}
          {tab === 'roles' && (
            <>
              <CardHeader>
                <CardTitle>Roles</CardTitle>
                <CardDescription>
                  What each role may do, and how far: their own records, their team’s, or
                  everyone’s. Start from a template such as SDR/BDR, Sales rep or Read only.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RolesEditor
                  roles={roleRows}
                  groups={permissionGroups(
                    PERMISSION_KEYS.filter((key) => permissionAvailable(key, ctx.tenant.features)),
                    isScoped,
                  )}
                  templates={ROLE_TEMPLATES.map((template) => ({
                    ...template,
                    grants: Object.fromEntries(
                      Object.entries(template.grants).map(([key, value]) => [key, String(value)]),
                    ),
                  }))}
                />
              </CardContent>
            </>
          )}
          {tab === 'lost' && (
            <>
              <CardHeader>
                <CardTitle>Lost reasons</CardTitle>
                <CardDescription>Asked every time something is marked lost.</CardDescription>
              </CardHeader>
              <CardContent>
                <LostReasonList items={lists.reasons} />
              </CardContent>
            </>
          )}
          {tab === 'team' && (
            <>
              <CardHeader>
                <CardTitle>Team</CardTitle>
                <CardDescription>
                  People who can sign in and what their role lets them do. Each person chooses their
                  own password from a one-time link.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TeamTable
                  members={lists.members}
                  roles={lists.roles}
                  canManage={hasPermission(ctx, 'users.manage')}
                  currentUserId={ctx.userId}
                />
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
