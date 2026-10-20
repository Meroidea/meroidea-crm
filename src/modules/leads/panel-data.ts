import 'server-only';

import { formatDateTime } from '@/lib/format';
import { canAccess, scopeDecision } from '@/lib/permissions/scope';
import type { ContactDetail } from '@/modules/contacts/types';
import { listActiveMembers, listMemberIdsWithPermission } from '@/modules/members/queries';
import { getPipelineSummaries } from '@/modules/pipelines/queries';
import { hasPermission, type TenantContext } from '@/server/context';

import type { LeadPanelProps } from './components/lead-panel';
import { getLeadConfig, pickableStatuses } from './config';
import { completeness, fieldRefLabel, fieldRefValue, usesHandover } from './settings';

/** Everything the lead panel on a contact's page needs, worked out on the server. */
export async function leadPanelData(
  ctx: TenantContext,
  contact: ContactDetail,
): Promise<LeadPanelProps | null> {
  const lead = contact.lead;
  if (!lead) return null;
  const [config, members, pipelines, approvers] = await Promise.all([
    getLeadConfig(ctx),
    listActiveMembers(ctx),
    hasPermission(ctx, 'opportunities.create') ? getPipelineSummaries(ctx) : Promise.resolve([]),
    listMemberIdsWithPermission(ctx, 'opportunities.approve'),
  ]);
  const settings = config.settings;
  const type = lead.type ?? 'b2c';
  const path: LeadPanelProps['path'] = usesHandover(settings, type)
    ? 'handover'
    : settings.b2cApproval
      ? 'approval'
      : 'direct';

  const record = contact as unknown as Record<string, unknown>;
  const labels = Object.fromEntries(config.customContactFields.map((f) => [f.key, f.label]));
  const now = Date.now();
  const firstContactDue =
    (lead.assignedAt ?? contact.createdAt).getTime() + settings.sla.firstContactHours * 3_600_000;
  const assign = scopeDecision(ctx, 'contacts.assign');
  const canDecide =
    lead.handoverToUserId === ctx.userId ||
    (hasPermission(ctx, 'contacts.assign') &&
      (assign.kind === 'all' ||
        (assign.kind === 'owners' &&
          lead.handoverToUserId !== null &&
          assign.userIds.includes(lead.handoverToUserId))));
  const format = (value: Date | null) => (value ? formatDateTime(ctx, value) : null);

  return {
    contactId: contact.id,
    contactName: contact.fullName,
    timezone: ctx.tenant.timezone,
    lead: {
      type: lead.type,
      statusId: lead.statusId,
      statusName: lead.statusName,
      statusKind: lead.statusKind,
      statusColor: lead.statusColor,
      reasonName: lead.reasonName,
      reasonNote: lead.reasonNote,
      originatorName: lead.originatorName,
      handoverToName: lead.handoverToName,
      handoverSummary: lead.handoverSummary,
      rejectedReasonName: lead.rejectedReasonName,
      rejectedNote: lead.rejectedNote,
      companyName: contact.companyName,
      companyWebsite: contact.companyWebsite,
      interest: contact.interest,
    },
    when: {
      statusChanged: format(lead.statusChangedAt),
      firstContacted: format(lead.firstContactedAt),
      handoverAt: format(lead.handoverAt),
      handoverDue: format(lead.handoverDueAt),
      meeting: format(lead.handoverMeetingAt),
      rejectedAt: format(lead.rejectedAt),
      converted: format(lead.convertedAt),
    },
    overdue: {
      firstContact:
        !lead.firstContactedAt &&
        ['new', 'working', 'returned'].includes(lead.statusKind) &&
        now > firstContactDue,
      acceptance:
        lead.statusKind === 'pending_acceptance' &&
        lead.handoverDueAt !== null &&
        now > lead.handoverDueAt.getTime(),
    },
    completeness: completeness(settings.completenessFields, record),
    missingForHandover: settings.handoverRequiredFields
      .filter((ref) => fieldRefValue(ref, record) === '')
      .map((ref) => fieldRefLabel(ref, labels)),
    statuses: pickableStatuses(config, lead.type).map((status) => ({
      id: status.id,
      name: status.name,
      kind: status.kind,
      requiresReason: status.requiresReason,
    })),
    disqualifyReasons: config.reasons
      .filter((reason) => reason.kind === 'disqualify' && reason.isActive)
      .map((reason) => ({ value: reason.id, label: reason.name })),
    rejectReasons: config.reasons
      .filter((reason) => reason.kind === 'reject' && reason.isActive)
      .map((reason) => ({ value: reason.id, label: reason.name })),
    people: members.map((member) => ({
      value: member.userId,
      label: member.userId === ctx.userId ? `${member.fullName} (you)` : member.fullName,
    })),
    // Who a lead can go to: never yourself, and for an approval only someone who can approve
    // (handoverLead refuses anyone else).
    handoverPeople: members
      .filter(
        (member) =>
          member.userId !== ctx.userId &&
          (path !== 'approval' || approvers.includes(member.userId)),
      )
      .map((member) => ({ value: member.userId, label: member.fullName })),
    pipelines: pipelines
      .filter((pipeline) => pipeline.isActive)
      .map((pipeline) => ({ value: pipeline.id, label: pipeline.name })),
    contactRoles: settings.contactRoles,
    path,
    canEdit: hasPermission(ctx, 'contacts.edit') && canAccess(ctx, 'contacts.edit', contact),
    canDecide,
    canConvert: hasPermission(ctx, 'opportunities.create'),
    labels: {
      organization: ctx.tenant.labels.organization.singular,
      opportunity: ctx.tenant.labels.opportunity.singular,
    },
  };
}
