import 'server-only';

import { and, eq, ilike, inArray, isNull, or } from 'drizzle-orm';

import {
  contactLinks,
  contactOrganizations,
  contacts,
  leadReasons,
  organizations,
  tenantMemberships,
} from '@/db/schema';
import { AppError } from '@/lib/errors';
import { domainOf } from '@/lib/normalize';
import { assertCanAccess } from '@/lib/permissions/scope';
import { recordSystemActivity } from '@/modules/activities/service';
import { assertCanAssignContact, contactRecord } from '@/modules/contacts/access';
import { deliverEmails, notify, type PendingEmail } from '@/modules/notifications/service';
import { openOpportunity } from '@/modules/opportunities/service';
import { pipelineIdForLeadType } from '@/modules/pipelines/queries';
import { audit } from '@/server/audit';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls, type Tx } from '@/server/db/with-rls';

import { loadLeadConfig, systemStatus, type LeadConfig, type LeadStatus } from './config';
import { routeLead } from './routing';
import type {
  AcceptHandoverInput,
  AssignLeadsInput,
  ConvertLeadInput,
  HandoverInput,
  RejectHandoverInput,
  SetLeadStatusInput,
} from './schemas';
import { addBusinessDays, fieldRefLabel, fieldRefValue, usesHandover } from './settings';

type ContactRow = typeof contacts.$inferSelect;

async function loadLead(tx: Tx, ctx: TenantContext, id: string): Promise<ContactRow> {
  const [row] = await tx
    .select()
    .from(contacts)
    .where(
      and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, id), isNull(contacts.deletedAt)),
    )
    .limit(1)
    .for('update');
  if (!row) throw new AppError('NOT_FOUND', 'That record was not found.');
  return row;
}

function currentStatus(config: LeadConfig, lead: ContactRow): LeadStatus {
  const status = config.statuses.find((candidate) => candidate.id === lead.leadStatusId);
  if (!status) throw new AppError('CONFLICT', 'This person isn’t a lead yet.');
  return status;
}

const leadName = (lead: ContactRow) => lead.fullName ?? lead.firstName;
const leadUrl = (lead: ContactRow) => `/contacts/${lead.id}`;

async function moveStatus(
  tx: Tx,
  ctx: TenantContext,
  lead: ContactRow,
  from: LeadStatus,
  to: LeadStatus,
  extra: Partial<typeof contacts.$inferInsert> = {},
  note?: string | null,
) {
  const now = new Date();
  await tx
    .update(contacts)
    .set({
      leadStatusId: to.id,
      leadStatusChangedAt: now,
      updatedBy: ctx.userId,
      ...extra,
    })
    .where(and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, lead.id)));
  await recordSystemActivity(tx, ctx, {
    type: 'status_changed',
    subject: `Status: ${from.name} → ${to.name}`,
    body: note ?? null,
    contactId: lead.id,
    metadata: { fromStatusId: from.id, toStatusId: to.id },
  });
  await audit(tx, ctx, {
    action: 'update',
    entityType: 'contact',
    entityId: lead.id,
    changes: { leadStatusId: [from.id, to.id] },
  });
}

/** Moves a lead between New, working and closing statuses. Handover statuses have their own steps. */
export async function setLeadStatus(ctx: TenantContext, input: SetLeadStatusInput) {
  requirePermission(ctx, 'contacts.edit');
  return withRls(ctx, async (tx) => {
    const lead = await loadLead(tx, ctx, input.contactId);
    assertCanAccess(ctx, 'contacts.edit', contactRecord(lead));
    const config = await loadLeadConfig(tx, ctx);
    const from = currentStatus(config, lead);
    const to = config.statuses.find((status) => status.id === input.statusId);
    if (!to || !to.isActive || (to.leadType !== null && to.leadType !== lead.leadType)) {
      throw new AppError('VALIDATION', 'Choose one of the statuses.', { statusId: ['Invalid'] });
    }
    if (!['new', 'working', 'closed'].includes(to.kind)) {
      throw new AppError('VALIDATION', 'Use Hand over or Convert for that step.');
    }
    if (from.kind === 'pending_acceptance' || from.kind === 'converted') {
      throw new AppError(
        'CONFLICT',
        `This lead is ${from.name.toLowerCase()}; its status is set by that step.`,
      );
    }
    if (from.id === to.id) return { id: lead.id };

    let reasonId: string | null = null;
    if (to.kind === 'closed') {
      if (input.reasonId) {
        const reason = config.reasons.find(
          (candidate) => candidate.id === input.reasonId && candidate.kind === 'disqualify',
        );
        if (!reason || !reason.isActive) {
          throw new AppError('VALIDATION', 'Choose a reason.', { reasonId: ['Invalid'] });
        }
        reasonId = reason.id;
      } else if (to.requiresReason) {
        throw new AppError('VALIDATION', `Say why it is ${to.name.toLowerCase()}.`, {
          reasonId: ['Choose a reason'],
        });
      }
    }
    const firstTouch = to.kind === 'working' && !lead.firstContactedAt;
    await moveStatus(
      tx,
      ctx,
      lead,
      from,
      to,
      {
        leadReasonId: to.kind === 'closed' ? reasonId : null,
        leadReasonNote: to.kind === 'closed' ? input.note : null,
        ...(firstTouch ? { firstContactedAt: new Date() } : {}),
      },
      input.note,
    );
    return { id: lead.id };
  });
}

/** Gives leads to someone (or to the routing rules) from the queue or a list. */
export async function assignLeads(ctx: TenantContext, input: AssignLeadsInput) {
  requirePermission(ctx, 'contacts.assign');
  const outcome = await withRls(ctx, async (tx) => {
    const rows = await tx
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.tenantId, ctx.tenantId),
          inArray(contacts.id, input.contactIds),
          isNull(contacts.deletedAt),
        ),
      )
      .for('update');
    if (rows.length !== input.contactIds.length) {
      throw new AppError('NOT_FOUND', 'Some of those records were not found.');
    }
    const emails: PendingEmail[] = [];
    let assigned = 0;
    for (const lead of rows) {
      assertCanAccess(ctx, 'contacts.assign', contactRecord(lead));
      let owner: string | null;
      if (input.mode === 'auto') {
        owner = await routeLead(
          tx,
          ctx.tenantId,
          {
            leadType: lead.leadType,
            sourceId: lead.sourceId,
            subSourceId: lead.subSourceId,
            country: lead.country,
            region: lead.region,
            industry: lead.industry,
            companySize: lead.companySize,
            language: lead.language,
            interest: lead.interest,
          },
          'intake',
        );
        if (!owner) continue;
      } else {
        owner = input.ownerUserId;
        assertCanAssignContact(ctx, owner);
      }
      if (owner === lead.ownerUserId) continue;
      await tx
        .update(contacts)
        .set({ ownerUserId: owner, assignedAt: owner ? new Date() : null, updatedBy: ctx.userId })
        .where(and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, lead.id)));
      await recordSystemActivity(tx, ctx, {
        type: 'assigned',
        subject: owner ? 'Lead assigned' : 'Returned to the unassigned queue',
        contactId: lead.id,
        metadata: { from: lead.ownerUserId, to: owner, mode: input.mode },
      });
      await audit(tx, ctx, {
        action: 'owner_change',
        entityType: 'contact',
        entityId: lead.id,
        changes: { ownerUserId: [lead.ownerUserId, owner] },
      });
      assigned += 1;
      if (owner) {
        emails.push(
          ...(await notify(tx, ctx, [
            {
              userId: owner,
              type: 'lead_assigned',
              title: `Lead assigned to you: ${leadName(lead)}`,
              url: leadUrl(lead),
              email: true,
            },
          ])),
        );
      }
    }
    return { assigned, emails };
  });
  await deliverEmails(ctx, outcome.emails);
  return { assigned: outcome.assigned, skipped: input.contactIds.length - outcome.assigned };
}

async function assertActiveMember(tx: Tx, ctx: TenantContext, userId: string): Promise<void> {
  const [member] = await tx
    .select({ id: tenantMemberships.id })
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.tenantId, ctx.tenantId),
        eq(tenantMemberships.userId, userId),
        eq(tenantMemberships.status, 'active'),
        eq(tenantMemberships.isSupport, false),
      ),
    )
    .limit(1);
  if (!member) {
    throw new AppError('VALIDATION', 'Choose an active member of your team.', {
      toUserId: ['Not available'],
    });
  }
}

/**
 * Passes a qualified lead from the SDR/BDR to a sales rep (docs/leads.md §4.5), or — for a B2C
 * business that asks for it — submits a lead for approval before it becomes an opportunity.
 * Requires the business's handover fields, sets an acceptance deadline in business days, and
 * keeps the originator for credit. The lead waits as Pending acceptance.
 */
export async function handoverLead(ctx: TenantContext, input: HandoverInput) {
  requirePermission(ctx, 'contacts.edit');
  const outcome = await withRls(ctx, async (tx) => {
    const lead = await loadLead(tx, ctx, input.contactId);
    assertCanAccess(ctx, 'contacts.edit', contactRecord(lead));
    const config = await loadLeadConfig(tx, ctx);
    const from = currentStatus(config, lead);
    if (!['new', 'working', 'returned'].includes(from.kind)) {
      throw new AppError(
        'CONFLICT',
        `A lead that is ${from.name.toLowerCase()} can’t be handed over.`,
      );
    }
    const leadType = lead.leadType ?? 'b2b';
    const approvalOnly = !usesHandover(config.settings, leadType);
    if (approvalOnly && !config.settings.b2cApproval) {
      throw new AppError('CONFLICT', 'Leads like this are converted directly.');
    }

    if (!approvalOnly) {
      const labels = Object.fromEntries(config.customContactFields.map((f) => [f.key, f.label]));
      const missing = config.settings.handoverRequiredFields.filter(
        (ref) => fieldRefValue(ref, lead as unknown as Record<string, unknown>) === '',
      );
      if (missing.length > 0) {
        throw new AppError(
          'VALIDATION',
          `Fill in before handing over: ${missing.map((ref) => fieldRefLabel(ref, labels)).join(', ')}.`,
        );
      }
    }

    let toUserId = input.toUserId;
    if (!toUserId) {
      toUserId = await routeLead(
        tx,
        ctx.tenantId,
        {
          leadType: lead.leadType,
          sourceId: lead.sourceId,
          subSourceId: lead.subSourceId,
          country: lead.country,
          region: lead.region,
          industry: lead.industry,
          companySize: lead.companySize,
          language: lead.language,
          interest: lead.interest,
        },
        'handover',
      );
      if (!toUserId) {
        throw new AppError('VALIDATION', 'No routing rule matched. Choose who to hand it to.', {
          toUserId: ['Choose someone'],
        });
      }
    }
    await assertActiveMember(tx, ctx, toUserId);

    const now = new Date();
    const pending = systemStatus(config, 'pending_acceptance', lead.leadType);
    await moveStatus(
      tx,
      ctx,
      lead,
      from,
      pending,
      {
        handoverToUserId: toUserId,
        handoverAt: now,
        handoverDueAt: addBusinessDays(
          now,
          config.settings.sla.acceptanceBusinessDays,
          ctx.tenant.timezone,
        ),
        handoverMeetingAt: input.meetingAt,
        handoverSummary: input.summary,
        originatorUserId: lead.originatorUserId ?? lead.ownerUserId ?? ctx.userId,
        rejectedReasonId: null,
        rejectedNote: null,
        rejectedAt: null,
        rejectedBy: null,
      },
      input.summary,
    );
    await recordSystemActivity(tx, ctx, {
      type: 'handover',
      subject: approvalOnly ? 'Submitted for approval' : 'Handed over for acceptance',
      body: input.summary,
      contactId: lead.id,
      metadata: { toUserId, meetingAt: input.meetingAt?.toISOString() ?? null },
    });
    const emails = await notify(tx, ctx, [
      {
        userId: toUserId,
        type: 'handover_received',
        title: `${approvalOnly ? 'Approve' : 'Accept'} lead: ${leadName(lead)}`,
        url: leadUrl(lead),
        email: true,
      },
    ]);
    return { toUserId, emails };
  });
  await deliverEmails(ctx, outcome.emails);
  return { id: input.contactId, toUserId: outcome.toUserId };
}

/** The person a lead was handed to — or their manager, through contacts.assign — decides. */
function assertCanDecide(ctx: TenantContext, lead: ContactRow): void {
  // Someone who can't see the lead learns nothing about it, not even that it exists.
  assertCanAccess(ctx, 'contacts.view', contactRecord(lead));
  if (lead.handoverToUserId === ctx.userId) return;
  if (!hasPermission(ctx, 'contacts.assign')) {
    throw new AppError('FORBIDDEN', 'Only the person it was handed to can answer this.');
  }
  assertCanAssignContact(ctx, lead.handoverToUserId);
}

export type AccountMatch = {
  id: string;
  name: string;
  website: string | null;
  why: 'domain' | 'name';
};

/** Existing organizations a B2B lead's company might already be (by website domain or name). */
export async function findAccountMatches(
  ctx: TenantContext,
  contactId: string,
): Promise<AccountMatch[]> {
  requirePermission(ctx, 'contacts.view');
  return withRls(ctx, async (tx) => {
    const [lead] = await tx
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.tenantId, ctx.tenantId),
          eq(contacts.id, contactId),
          isNull(contacts.deletedAt),
        ),
      )
      .limit(1);
    if (!lead) throw new AppError('NOT_FOUND', 'That record was not found.');
    assertCanAccess(ctx, 'contacts.view', contactRecord(lead));
    return accountMatches(tx, ctx, lead.companyName, lead.companyWebsite);
  });
}

async function accountMatches(
  tx: Tx,
  ctx: TenantContext,
  name: string | null,
  website: string | null,
): Promise<AccountMatch[]> {
  const domain = domainOf(website);
  if (!name && !domain) return [];
  const rows = await tx
    .select({
      id: organizations.id,
      name: organizations.name,
      website: organizations.website,
      domain: organizations.domain,
    })
    .from(organizations)
    .where(
      and(
        eq(organizations.tenantId, ctx.tenantId),
        isNull(organizations.deletedAt),
        or(
          domain ? eq(organizations.domain, domain) : undefined,
          name ? ilike(organizations.name, name.trim()) : undefined,
        ),
      ),
    )
    .limit(5);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    website: row.website,
    why: domain && row.domain === domain ? 'domain' : 'name',
  }));
}

/**
 * Turns a lead into an opportunity (docs/leads.md §4.7, §5.4). B2B: links or creates the
 * organization (offering an existing match rather than a duplicate), files the person under it
 * with their role, and opens the opportunity there. B2C: the person is the record. Source,
 * sub-source and originator carry over; all history stays on the person.
 */
async function convert(
  tx: Tx,
  ctx: TenantContext,
  config: LeadConfig,
  lead: ContactRow,
  input: ConvertLeadInput,
  ownerUserId: string,
): Promise<{ opportunityId: string; emails: PendingEmail[] }> {
  requirePermission(ctx, 'opportunities.create');
  let organizationId: string | null = null;

  if (lead.leadType === 'b2b') {
    if (input.organization.mode === 'existing') {
      const [organization] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(
          and(
            eq(organizations.tenantId, ctx.tenantId),
            eq(organizations.id, input.organization.id),
            isNull(organizations.deletedAt),
          ),
        )
        .limit(1);
      if (!organization) throw new AppError('NOT_FOUND', 'That organization was not found.');
      organizationId = organization.id;
    } else if (input.organization.mode === 'new') {
      const name = input.organization.name;
      const website = input.organization.website ?? lead.companyWebsite;
      if (!input.organization.confirmNew) {
        const matches = await accountMatches(tx, ctx, name, website);
        if (matches.length > 0) {
          throw new AppError(
            'DUPLICATE',
            `${ctx.tenant.labels.organization.singular} “${matches[0]?.name}” may already exist. Link to it, or create a new one anyway.`,
          );
        }
      }
      const [created] = await tx
        .insert(organizations)
        .values({
          tenantId: ctx.tenantId,
          name,
          website,
          domain: domainOf(website),
          industry: lead.industry,
          companySize: lead.companySize,
          country: lead.country,
          city: lead.city,
          region: lead.region,
          ownerUserId,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: organizations.id });
      if (!created) throw new AppError('INTERNAL', 'Could not save the organization.');
      organizationId = created.id;
      await audit(tx, ctx, {
        action: 'create',
        entityType: 'organization',
        entityId: created.id,
        context: { fromLead: lead.id },
      });
    } else {
      throw new AppError(
        'VALIDATION',
        `Choose the ${ctx.tenant.labels.organization.singular.toLowerCase()}.`,
      );
    }
    await tx
      .insert(contactOrganizations)
      .values({
        tenantId: ctx.tenantId,
        contactId: lead.id,
        organizationId,
        relationship: input.contactRole ?? 'Contact',
        isPrimary: true,
      })
      .onConflictDoNothing();
  }

  const pipelineId =
    input.pipelineId ?? (await pipelineIdForLeadType(tx, ctx.tenantId, lead.leadType));
  const opportunity = await openOpportunity(tx, ctx, {
    contactId: lead.id,
    organizationId,
    name: input.opportunityName,
    pipelineId,
    stageId: null,
    ownerUserId,
    sourceId: lead.sourceId,
    subSourceId: lead.subSourceId,
    originatorUserId: lead.originatorUserId,
    partnerId: null,
    amount: hasPermission(ctx, 'revenue.view') ? input.amount : null,
    expectedCloseDate: input.expectedCloseDate,
    product: input.product ?? lead.interest,
    probability: null,
    nextStep: input.nextStep,
    customFields: {},
  });

  const from = currentStatus(config, lead);
  const converted = systemStatus(config, 'converted', lead.leadType);
  await moveStatus(tx, ctx, lead, from, converted, {
    convertedAt: new Date(),
    ownerUserId,
    leadReasonId: null,
    leadReasonNote: null,
  });
  await recordSystemActivity(tx, ctx, {
    type: 'converted',
    subject: `Converted to ${ctx.tenant.labels.opportunity.singular.toLowerCase()} “${input.opportunityName}”`,
    contactId: lead.id,
    opportunityId: opportunity.id,
    metadata: { organizationId },
  });
  return { opportunityId: opportunity.id, emails: opportunity.emails };
}

/** The sales rep (or approver) accepts: the lead converts, owned by them. */
export async function acceptHandover(ctx: TenantContext, input: AcceptHandoverInput) {
  requirePermission(ctx, 'opportunities.create');
  const outcome = await withRls(ctx, async (tx) => {
    const lead = await loadLead(tx, ctx, input.contactId);
    const config = await loadLeadConfig(tx, ctx);
    if (currentStatus(config, lead).kind !== 'pending_acceptance' || !lead.handoverToUserId) {
      throw new AppError('CONFLICT', 'This lead isn’t waiting to be accepted.');
    }
    assertCanDecide(ctx, lead);
    const owner = lead.handoverToUserId;
    const result = await convert(tx, ctx, config, lead, input, owner);
    await recordSystemActivity(tx, ctx, {
      type: 'handover_accepted',
      subject: 'Handover accepted',
      contactId: lead.id,
      opportunityId: result.opportunityId,
    });
    const notices = [lead.originatorUserId, lead.ownerUserId]
      .filter((id, index, all): id is string => !!id && all.indexOf(id) === index && id !== owner)
      .map((userId) => ({
        userId,
        type: 'handover_accepted' as const,
        title: `${leadName(lead)} was accepted`,
        url: leadUrl(lead),
        email: true,
      }));
    result.emails.push(...(await notify(tx, ctx, notices)));
    return result;
  });
  await deliverEmails(ctx, outcome.emails);
  return { id: input.contactId, opportunityId: outcome.opportunityId };
}

/** The sales rep turns a handover down with a reason; it goes back to the SDR/BDR as Returned. */
export async function rejectHandover(ctx: TenantContext, input: RejectHandoverInput) {
  requirePermission(ctx, 'contacts.view');
  const outcome = await withRls(ctx, async (tx) => {
    const lead = await loadLead(tx, ctx, input.contactId);
    const config = await loadLeadConfig(tx, ctx);
    const from = currentStatus(config, lead);
    if (from.kind !== 'pending_acceptance' || !lead.handoverToUserId) {
      throw new AppError('CONFLICT', 'This lead isn’t waiting to be accepted.');
    }
    assertCanDecide(ctx, lead);
    const [reason] = await tx
      .select({ id: leadReasons.id, name: leadReasons.name })
      .from(leadReasons)
      .where(
        and(
          eq(leadReasons.tenantId, ctx.tenantId),
          eq(leadReasons.id, input.reasonId),
          eq(leadReasons.kind, 'reject'),
          eq(leadReasons.isActive, true),
        ),
      )
      .limit(1);
    if (!reason) throw new AppError('VALIDATION', 'Choose a reason.', { reasonId: ['Invalid'] });

    const returned = systemStatus(config, 'returned', lead.leadType);
    const rejectedBy = ctx.userId;
    await moveStatus(
      tx,
      ctx,
      lead,
      from,
      returned,
      {
        handoverToUserId: null,
        handoverDueAt: null,
        rejectedReasonId: reason.id,
        rejectedNote: input.note,
        rejectedAt: new Date(),
        rejectedBy,
      },
      input.note,
    );
    await recordSystemActivity(tx, ctx, {
      type: 'handover_rejected',
      subject: `Handover rejected: ${reason.name}`,
      body: input.note,
      contactId: lead.id,
      metadata: { reasonId: reason.id, rejectedFor: lead.handoverToUserId },
    });
    const back = lead.originatorUserId ?? lead.ownerUserId;
    return back
      ? notify(tx, ctx, [
          {
            userId: back,
            type: 'handover_rejected',
            title: `${leadName(lead)} was returned: ${reason.name}`,
            url: leadUrl(lead),
            email: true,
          },
        ])
      : [];
  });
  await deliverEmails(ctx, outcome);
  return { id: input.contactId };
}

/**
 * Converts a lead directly — the B2C path without a qualification step or approval
 * (docs/leads.md §5.4). The person converting becomes the opportunity's owner unless they choose
 * someone they may assign to.
 */
export async function convertLead(
  ctx: TenantContext,
  input: ConvertLeadInput & { ownerUserId: string | null },
) {
  requirePermission(ctx, 'contacts.edit');
  const outcome = await withRls(ctx, async (tx) => {
    const lead = await loadLead(tx, ctx, input.contactId);
    assertCanAccess(ctx, 'contacts.edit', contactRecord(lead));
    const config = await loadLeadConfig(tx, ctx);
    const from = currentStatus(config, lead);
    if (!['new', 'working', 'returned'].includes(from.kind)) {
      throw new AppError(
        'CONFLICT',
        `A lead that is ${from.name.toLowerCase()} can’t be converted.`,
      );
    }
    const leadType = lead.leadType ?? 'b2c';
    if (usesHandover(config.settings, leadType)) {
      throw new AppError('CONFLICT', 'Hand this lead over to a sales rep to convert it.');
    }
    if (config.settings.b2cApproval) {
      throw new AppError('CONFLICT', 'Converting needs approval: submit it for approval instead.');
    }
    const owner = input.ownerUserId ?? lead.ownerUserId ?? ctx.userId;
    if (owner !== ctx.userId) assertCanAssignContact(ctx, owner);
    return convert(tx, ctx, config, lead, input, owner);
  });
  await deliverEmails(ctx, outcome.emails);
  return { id: input.contactId, opportunityId: outcome.opportunityId };
}

/** Links two people as a household or group (B2C): parent and student, a couple… */
export async function linkContacts(
  ctx: TenantContext,
  input: { contactId: string; relatedContactId: string; relationship: string },
) {
  requirePermission(ctx, 'contacts.edit');
  if (input.contactId === input.relatedContactId) {
    throw new AppError('VALIDATION', 'Choose someone else.', { relatedContactId: ['Same person'] });
  }
  return withRls(ctx, async (tx) => {
    const lead = await loadLead(tx, ctx, input.contactId);
    assertCanAccess(ctx, 'contacts.edit', contactRecord(lead));
    const related = await loadLead(tx, ctx, input.relatedContactId);
    assertCanAccess(ctx, 'contacts.view', contactRecord(related));
    const [link] = await tx
      .insert(contactLinks)
      .values({
        tenantId: ctx.tenantId,
        contactId: lead.id,
        relatedContactId: related.id,
        relationship: input.relationship,
        createdBy: ctx.userId,
      })
      .onConflictDoNothing()
      .returning({ id: contactLinks.id });
    if (!link) throw new AppError('CONFLICT', 'They are already linked.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'contact',
      entityId: lead.id,
      context: { linkedContactId: related.id, relationship: input.relationship },
    });
    return link;
  });
}

export async function unlinkContacts(
  ctx: TenantContext,
  input: { contactId: string; linkId: string },
) {
  requirePermission(ctx, 'contacts.edit');
  return withRls(ctx, async (tx) => {
    const lead = await loadLead(tx, ctx, input.contactId);
    assertCanAccess(ctx, 'contacts.edit', contactRecord(lead));
    const [removed] = await tx
      .delete(contactLinks)
      .where(
        and(
          eq(contactLinks.tenantId, ctx.tenantId),
          eq(contactLinks.id, input.linkId),
          or(eq(contactLinks.contactId, lead.id), eq(contactLinks.relatedContactId, lead.id)),
        ),
      )
      .returning({ id: contactLinks.id });
    if (!removed) throw new AppError('NOT_FOUND', 'That link was not found.');
    await audit(tx, ctx, {
      action: 'update',
      entityType: 'contact',
      entityId: lead.id,
      context: { unlinkedContactLinkId: input.linkId },
    });
    return removed;
  });
}
