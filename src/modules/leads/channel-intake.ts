import 'server-only';

import { and, eq, isNull, or } from 'drizzle-orm';

import { auditLogs, contacts, leadIntakeEvents, leadStatuses, tenants } from '@/db/schema';
import { normalizeEmail } from '@/lib/normalize';
import { isTenantOpen } from '@/lib/tenant/status';
import { recordSystemActivity } from '@/modules/activities/service';
import { notify } from '@/modules/notifications/service';
import type { Tx } from '@/server/db/with-rls';

import { systemStatus, type LeadStatus } from './config';
import { routeLead } from './routing';
import { allowedLeadTypes, readCrmSettings } from './settings';

/*
 * Finding the CRM contact behind someone who wrote to the business on a channel (WhatsApp, a
 * social account, and later email and live chat), ADR-068. Runs inside the caller's transaction:
 * the privileged one of a verified webhook, never a person's request. A contact is linked only
 * when exactly one matches; several matches are left for staff to choose, so a shared family
 * number or a reused address never joins two people's histories.
 */

export type ChannelKind = 'whatsapp' | 'facebook' | 'instagram' | 'tiktok' | 'email' | 'livechat';

export const CHANNEL_NAMES: Record<ChannelKind, string> = {
  whatsapp: 'WhatsApp',
  facebook: 'Messenger',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  email: 'Email',
  livechat: 'Live chat',
};

export type ChannelSender = {
  tenantId: string;
  channel: ChannelKind;
  conversationId: string;
  name: string | null;
  email: string | null;
  /** In international form (+61…). */
  phone: string | null;
};

export type ChannelMatch =
  | { kind: 'auto' | 'created'; contactId: string }
  | { kind: 'suggested'; contactId: null }
  | { kind: 'none'; contactId: null };

/** Splits "Sam Lee Chen" into a first name and the rest, with a fallback when none is known. */
export function senderNames(
  name: string | null,
  channel: ChannelKind,
): { firstName: string; lastName: string | null } {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { firstName: `${CHANNEL_NAMES[channel]} sender`, lastName: null };
  const [first, ...rest] = words;
  return {
    firstName: first!.slice(0, 100),
    lastName: rest.length > 0 ? rest.join(' ').slice(0, 100) : null,
  };
}

/**
 * Looks the sender up by email or phone and, when nobody matches and the account is set to,
 * creates a lead for them: routed like a website enquiry, in the business's "new" lead status,
 * with the account's lead source. What they wrote is never copied onto the contact or its
 * timeline; the conversation itself is the record.
 */
export async function matchChannelSender(
  tx: Tx,
  sender: ChannelSender,
  options: {
    createLeadForUnknown: boolean;
    leadSourceId: string | null;
    /**
     * Whether the sender is who they say (an email that passed DKIM or DMARC, ADR-070). An
     * untrusted single match is offered to staff instead of being linked.
     */
    trusted?: boolean;
  },
): Promise<ChannelMatch> {
  const [tenant] = await tx
    .select({
      status: tenants.status,
      features: tenants.features,
      settings: tenants.settings,
      country: tenants.defaultCountry,
    })
    .from(tenants)
    .where(eq(tenants.id, sender.tenantId))
    .limit(1);
  // Contacts belong to the CRM: without it switched on there is nothing to find or create.
  if (!tenant || !isTenantOpen(tenant.status) || !tenant.features.includes('crm')) {
    return { kind: 'none', contactId: null };
  }

  const email = normalizeEmail(sender.email);
  const phone = sender.phone && /^\+\d{6,15}$/.test(sender.phone) ? sender.phone : null;
  if (email || phone) {
    const found = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.tenantId, sender.tenantId),
          isNull(contacts.deletedAt),
          or(
            email ? eq(contacts.emailNormalized, email) : undefined,
            phone ? eq(contacts.phoneE164, phone) : undefined,
          ),
        ),
      )
      .limit(2);
    if (found.length === 1 && options.trusted !== false) {
      return { kind: 'auto', contactId: found[0]!.id };
    }
    if (found.length > 0) return { kind: 'suggested', contactId: null };
  }
  if (!options.createLeadForUnknown) return { kind: 'none', contactId: null };

  const crm = readCrmSettings(tenant.settings as Record<string, unknown>);
  const types = allowedLeadTypes(crm);
  // Someone writing to a business on a messaging channel is most often a person, not a company.
  const leadType = types.includes('b2c') ? 'b2c' : types[0]!;
  const statuses = (await tx
    .select({
      id: leadStatuses.id,
      name: leadStatuses.name,
      kind: leadStatuses.kind,
      leadType: leadStatuses.leadType,
      requiresReason: leadStatuses.requiresReason,
      isSystem: leadStatuses.isSystem,
      color: leadStatuses.color,
      isActive: leadStatuses.isActive,
      position: leadStatuses.position,
    })
    .from(leadStatuses)
    .where(
      and(eq(leadStatuses.tenantId, sender.tenantId), eq(leadStatuses.isSystem, true)),
    )) as LeadStatus[];
  const status = systemStatus({ statuses }, 'new', leadType);
  const owner = await routeLead(
    tx,
    sender.tenantId,
    {
      leadType,
      sourceId: options.leadSourceId,
      subSourceId: null,
      country: tenant.country,
      region: null,
      industry: null,
      companySize: null,
      language: null,
      interest: null,
    },
    'intake',
  );
  const now = new Date();
  const names = senderNames(sender.name, sender.channel);
  const [created] = await tx
    .insert(contacts)
    .values({
      tenantId: sender.tenantId,
      ...names,
      email: sender.email?.trim() || null,
      emailNormalized: email,
      phone,
      phoneE164: phone,
      sourceId: options.leadSourceId,
      leadType,
      leadStatusId: status.id,
      leadStatusChangedAt: now,
      ownerUserId: owner,
      assignedAt: owner ? now : null,
      lastActivityAt: now,
    })
    .returning({ id: contacts.id });
  if (!created) throw new Error('contact not stored');

  // Only which conversation it came from: never the message itself (rules/security.md).
  await tx.insert(leadIntakeEvents).values({
    tenantId: sender.tenantId,
    channel: sender.channel,
    payload: { conversationId: sender.conversationId },
    status: 'created',
    contactId: created.id,
    processedAt: now,
  });
  const system = { tenantId: sender.tenantId, userId: null };
  await recordSystemActivity(tx, system, {
    type: 'enquiry',
    subject: `First message on ${CHANNEL_NAMES[sender.channel]}`,
    body: null,
    contactId: created.id,
    metadata: { conversationId: sender.conversationId, channel: sender.channel },
  });
  await tx.insert(auditLogs).values({
    tenantId: sender.tenantId,
    actorUserId: null,
    actorType: 'system',
    action: 'create',
    entityType: 'contact',
    entityId: created.id,
    context: { source: 'inbox', channel: sender.channel },
  });
  if (owner) {
    // In the workspace only: an email would wait on the webhook that is being answered.
    await notify(tx, system, [
      {
        userId: owner,
        type: 'lead_assigned',
        title: `New lead from ${CHANNEL_NAMES[sender.channel]}: ${names.firstName}${names.lastName ? ` ${names.lastName}` : ''}`,
        url: `/contacts/${created.id}`,
      },
    ]);
  }
  return { kind: 'created', contactId: created.id };
}
