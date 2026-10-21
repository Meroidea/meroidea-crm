import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';

import {
  auditLogs,
  roles,
  serviceAgreements,
  tenantAgreements,
  tenantMemberships,
  tenants,
  users,
} from '@/db/schema';
import { isTenantOpen } from '@/lib/tenant/status';
import { diffChanges } from '@/lib/audit-diff';
import { AppError } from '@/lib/errors';
import { FEATURES, isFeatureKey, type FeatureKey } from '@/lib/features';
import { notify } from '@/modules/notifications/service';
import { provisionTenant } from '@/modules/tenants/provision';
import { createLinkToken } from '@/server/crypto';
import { adminDb } from '@/server/db/admin';
import { sendEmail } from '@/server/email';
import { renderEmail } from '@/server/email-template';
import { serverEnv } from '@/server/env';
import type { PlatformAdmin } from '@/server/platform';
import { createSupabaseAdminClient } from '@/server/supabase/admin';

import type {
  BusinessIdentityInput,
  CreateBusinessInput,
  PublishAgreementInput,
  SetLocationInput,
} from './schemas';

/*
 * The platform owner's side of Meroidea (ADR-029). These functions cross every business, so they
 * use the privileged connection; each one takes the verified PlatformAdmin as proof the caller
 * was checked, and anything that touches a business is written to that business's own audit log.
 */

export type BusinessRow = {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  status: string;
  features: FeatureKey[];
  members: number;
  createdAt: Date;
  locationLatitude: string | null;
  locationLongitude: string | null;
  clockRadiusMetres: number;
  timezone: string;
  legalName: string | null;
  businessNumber: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
};

const columns = {
  id: tenants.id,
  name: tenants.name,
  slug: tenants.slug,
  industry: tenants.industry,
  status: tenants.status,
  features: tenants.features,
  members: sql<number>`(select count(*)::int from tenant_memberships m
    where m.tenant_id = tenants.id and m.status = 'active' and not m.is_support)`,
  createdAt: tenants.createdAt,
  locationLatitude: tenants.locationLatitude,
  locationLongitude: tenants.locationLongitude,
  clockRadiusMetres: tenants.clockRadiusMetres,
  timezone: tenants.timezone,
  legalName: tenants.legalName,
  businessNumber: tenants.businessNumber,
  primaryContactName: tenants.primaryContactName,
  primaryContactEmail: tenants.primaryContactEmail,
  primaryContactPhone: tenants.primaryContactPhone,
};

const clean = (row: Omit<BusinessRow, 'features'> & { features: string[] }): BusinessRow => ({
  ...row,
  features: row.features.filter(isFeatureKey),
});

// `admin` is taken by the read functions too, unused, so they cannot be called without one.
export async function listBusinesses(admin: PlatformAdmin): Promise<BusinessRow[]> {
  void admin;
  const rows = await adminDb().select(columns).from(tenants).orderBy(asc(tenants.name));
  return rows.map(clean);
}

export async function getBusiness(admin: PlatformAdmin, id: string): Promise<BusinessRow | null> {
  void admin;
  const [row] = await adminDb().select(columns).from(tenants).where(eq(tenants.id, id)).limit(1);
  return row ? clean(row) : null;
}

function record(
  tenantId: string,
  admin: PlatformAdmin,
  entry: { action: string; context: Record<string, unknown> },
) {
  return adminDb().insert(auditLogs).values({
    tenantId,
    actorUserId: admin.userId,
    actorType: 'platform',
    action: entry.action,
    entityType: 'tenant',
    entityId: tenantId,
    context: entry.context,
  });
}

/** How long the link to accept the service agreement stays usable. */
const AGREEMENT_LINK_DAYS = 14;

/**
 * What happened to the agreement link. The link comes back to the platform owner only when it
 * could not be emailed, to pass on by hand. Once it is in the admin's inbox, the platform owner
 * holding it too could accept the agreement as the admin and get their password link (ADR-047).
 * Never stored.
 */
export type AgreementLinkDelivery = { emailed: true } | { emailed: false; link: string };

const agreementDelivery = (emailed: boolean, link: string): AgreementLinkDelivery =>
  emailed ? { emailed: true } : { emailed: false, link };

async function latestAgreement() {
  const [agreement] = await adminDb()
    .select({ id: serviceAgreements.id, title: serviceAgreements.title })
    .from(serviceAgreements)
    .orderBy(desc(serviceAgreements.version))
    .limit(1);
  return agreement ?? null;
}

async function emailAgreementLink(input: {
  to: string;
  name: string;
  businessName: string;
  link: string;
}): Promise<boolean> {
  const result = await sendEmail({
    to: input.to,
    subject: `Accept your Meroidea service agreement for ${input.businessName}`,
    ...renderEmail({
      sender: { kind: 'platform' },
      preheader: `${input.businessName}'s workspace is ready. Accept the agreement to open it.`,
      heading: `Welcome to Meroidea, ${input.name}`,
      blocks: [
        {
          type: 'paragraph',
          text: `${input.businessName} has been set up on Meroidea, and you are its admin.`,
        },
        { type: 'paragraph', text: 'Two quick steps open your workspace:' },
        {
          type: 'list',
          items: ['Read and accept the service agreement.', 'Choose your password and sign in.'],
        },
        { type: 'button', label: 'Read and accept the agreement', url: input.link },
        {
          type: 'note',
          text: `This link works once and expires in ${AGREEMENT_LINK_DAYS} days. If you were not expecting it, you can ignore this email.`,
        },
      ],
      reason: `You received this because ${input.businessName} was set up on Meroidea with this email address as its admin.`,
    }),
  });
  return result.sent;
}

/**
 * Onboards a client business (ADR-029, ADR-047): its workspace with who it is, where it is and the
 * features agreed with it, and a login for its admin that nobody can use yet. The admin is sent a
 * one-time link to accept the service agreement; only then does the workspace open and do they
 * choose their own password. Nobody else ever knows it.
 */
export async function createBusiness(
  admin: PlatformAdmin,
  input: CreateBusinessInput,
): Promise<AgreementLinkDelivery & { tenantId: string; adminEmail: string }> {
  const agreement = await latestAgreement();
  if (!agreement) {
    throw new AppError(
      'CONFLICT',
      'Publish the service agreement before onboarding a business: Platform → Service agreement.',
    );
  }

  const adminEmail = input.adminEmail.toLowerCase();
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.auth.admin.createUser({
    email: adminEmail,
    // Never used: the admin chooses their own once they have accepted the agreement.
    password: randomBytes(24).toString('base64url'),
    email_confirm: true,
    user_metadata: { full_name: input.adminName },
  });
  if (error || !data.user) {
    throw new AppError(
      'CONFLICT',
      'That email already has a login. Use a different address for this admin.',
      {
        adminEmail: ['This email already has a login'],
      },
    );
  }
  const userId = data.user.id;

  const link = createLinkToken();
  let tenantId: string;
  try {
    ({ tenantId } = await provisionTenant({
      userId,
      companyName: input.companyName,
      industry: input.businessType,
      features: input.features,
      source: 'platform',
      // In the same transaction as the workspace: it never exists, even for a moment, as an open
      // business without its identity and its agreement waiting to be accepted.
      finish: async (tx, tenantId) => {
        await tx
          .update(tenants)
          .set({
            status: 'awaiting_agreement',
            legalName: input.legalName,
            businessNumber: input.businessNumber,
            primaryContactName: input.primaryContactName,
            primaryContactEmail: input.primaryContactEmail.toLowerCase(),
            primaryContactPhone: input.primaryContactPhone,
            locationLatitude: input.latitude || null,
            locationLongitude: input.longitude || null,
            clockRadiusMetres: input.radiusMetres,
          })
          .where(eq(tenants.id, tenantId));
        await tx.insert(tenantAgreements).values({
          tenantId,
          agreementId: agreement.id,
          recipientUserId: userId,
          recipientName: input.adminName,
          recipientEmail: adminEmail,
          tokenHash: link.hash,
          tokenExpiresAt: new Date(Date.now() + AGREEMENT_LINK_DAYS * 86_400_000),
        });
        await tx.insert(auditLogs).values({
          tenantId,
          actorUserId: admin.userId,
          actorType: 'platform',
          action: 'create',
          entityType: 'tenant',
          entityId: tenantId,
          context: {
            onboardedBy: 'platform',
            features: input.features,
            clockLocation: input.latitude ? 'set' : 'none',
            agreementSent: true,
          },
        });
      },
    }));
  } catch (cause) {
    // Don't leave a login behind for a business that was never created.
    await supabase.auth.admin.deleteUser(userId);
    throw cause;
  }

  const url = agreementUrl(link.token);
  const emailed = await emailAgreementLink({
    to: adminEmail,
    name: input.adminName,
    businessName: input.companyName,
    link: url,
  });
  return { tenantId, adminEmail, ...agreementDelivery(emailed, url) };
}

function agreementUrl(token: string): string {
  return new URL(`/agreement/${token}`, serverEnv().APP_URL).toString();
}

/**
 * Sends the business's admin a fresh link to accept the service agreement, at its latest version.
 * The previous link stops working.
 */
export async function resendAgreementLink(
  admin: PlatformAdmin,
  tenantId: string,
): Promise<AgreementLinkDelivery> {
  const agreement = await latestAgreement();
  if (!agreement) throw new AppError('CONFLICT', 'No service agreement has been published.');
  const link = createLinkToken();
  const sent = await adminDb().transaction(async (tx) => {
    const [open] = await tx
      .update(tenantAgreements)
      .set({
        agreementId: agreement.id,
        tokenHash: link.hash,
        tokenExpiresAt: new Date(Date.now() + AGREEMENT_LINK_DAYS * 86_400_000),
        sentAt: new Date(),
      })
      .where(and(eq(tenantAgreements.tenantId, tenantId), isNull(tenantAgreements.acceptedAt)))
      .returning({
        name: tenantAgreements.recipientName,
        email: tenantAgreements.recipientEmail,
      });
    if (!open) {
      throw new AppError('NOT_FOUND', 'This business has no agreement waiting to be accepted.');
    }
    const [business] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    await tx.insert(auditLogs).values({
      tenantId,
      actorUserId: admin.userId,
      actorType: 'platform',
      action: 'update',
      entityType: 'tenant_agreement',
      context: { agreementLinkResent: true },
    });
    return { ...open, businessName: business?.name ?? '' };
  });

  const url = agreementUrl(link.token);
  const emailed = await emailAgreementLink({
    to: sent.email,
    name: sent.name,
    businessName: sent.businessName,
    link: url,
  });
  return agreementDelivery(emailed, url);
}

export type BusinessAgreement = {
  title: string;
  version: number;
  recipientName: string;
  recipientEmail: string;
  sentAt: Date;
  tokenExpiresAt: Date | null;
  acceptedAt: Date | null;
  acceptedName: string | null;
};

/** The business's most recent agreement request: waiting, or the latest acceptance. */
export async function getBusinessAgreement(
  admin: PlatformAdmin,
  tenantId: string,
): Promise<BusinessAgreement | null> {
  void admin;
  const [row] = await adminDb()
    .select({
      title: serviceAgreements.title,
      version: serviceAgreements.version,
      recipientName: tenantAgreements.recipientName,
      recipientEmail: tenantAgreements.recipientEmail,
      sentAt: tenantAgreements.sentAt,
      tokenExpiresAt: tenantAgreements.tokenExpiresAt,
      acceptedAt: tenantAgreements.acceptedAt,
      acceptedName: tenantAgreements.acceptedName,
    })
    .from(tenantAgreements)
    .innerJoin(serviceAgreements, eq(serviceAgreements.id, tenantAgreements.agreementId))
    .where(eq(tenantAgreements.tenantId, tenantId))
    // The open request first, otherwise the most recent acceptance.
    .orderBy(sql`${tenantAgreements.acceptedAt} desc nulls first`)
    .limit(1);
  return row ?? null;
}

/**
 * Changes who a business is: its name, legal name, ABN and primary contact. Only the platform
 * owner can (ADR-047). Payslips already made keep the details printed on them.
 */
export async function updateBusinessIdentity(
  admin: PlatformAdmin,
  input: BusinessIdentityInput,
): Promise<{ id: string }> {
  const db = adminDb();
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        name: tenants.name,
        legalName: tenants.legalName,
        businessNumber: tenants.businessNumber,
        primaryContactName: tenants.primaryContactName,
        primaryContactEmail: tenants.primaryContactEmail,
        primaryContactPhone: tenants.primaryContactPhone,
      })
      .from(tenants)
      .where(eq(tenants.id, input.tenantId))
      .for('update')
      .limit(1);
    if (!before) throw new AppError('NOT_FOUND', 'That business was not found.');
    const next = {
      name: input.companyName,
      legalName: input.legalName,
      businessNumber: input.businessNumber,
      primaryContactName: input.primaryContactName,
      primaryContactEmail: input.primaryContactEmail.toLowerCase(),
      primaryContactPhone: input.primaryContactPhone,
    };
    const changes = diffChanges(before, next);
    if (Object.keys(changes).length === 0) return { id: input.tenantId };
    await tx.update(tenants).set(next).where(eq(tenants.id, input.tenantId));
    await tx.insert(auditLogs).values({
      tenantId: input.tenantId,
      actorUserId: admin.userId,
      actorType: 'platform',
      action: 'update',
      entityType: 'tenant',
      entityId: input.tenantId,
      changes,
    });
    return { id: input.tenantId };
  });
}

export type AgreementVersion = {
  id: string;
  version: number;
  title: string;
  body: string;
  publishedAt: Date;
  accepted: number;
};

export async function listAgreements(admin: PlatformAdmin): Promise<AgreementVersion[]> {
  void admin;
  return adminDb()
    .select({
      id: serviceAgreements.id,
      version: serviceAgreements.version,
      title: serviceAgreements.title,
      body: serviceAgreements.body,
      publishedAt: serviceAgreements.publishedAt,
      accepted: sql<number>`(select count(*)::int from tenant_agreements ta
        where ta.agreement_id = service_agreements.id and ta.accepted_at is not null)`,
    })
    .from(serviceAgreements)
    .orderBy(desc(serviceAgreements.version));
}

/**
 * Publishes new wording as the next version. Businesses that already accepted keep the version
 * they accepted; links sent from now on carry the new one.
 */
export async function publishAgreement(
  admin: PlatformAdmin,
  input: PublishAgreementInput,
): Promise<{ id: string; version: number }> {
  const [published] = await adminDb()
    .insert(serviceAgreements)
    .values({
      version: sql`(select coalesce(max(version), 0) + 1 from service_agreements)`,
      title: input.title,
      body: input.body,
      publishedBy: admin.userId,
    })
    .returning({ id: serviceAgreements.id, version: serviceAgreements.version });
  if (!published) throw new AppError('INTERNAL', 'The agreement could not be published.');
  return published;
}

const ROLE_ACCESS_URL = '/settings?tab=roles';

/**
 * The switched-on features' names, joined with commas only: several labels already contain "and"
 * ("Payroll and payslips"), so "A, B and C" would read as more features than there are.
 */
function featureWords(labels: string[]) {
  return { names: labels.join(', '), them: labels.length > 1 ? 'them' : 'it' };
}

async function emailFeaturesSwitchedOn(input: {
  businessName: string;
  labels: string[];
  recipients: { email: string; fullName: string }[];
}): Promise<boolean> {
  const { names, them } = featureWords(input.labels);
  const link = new URL(ROLE_ACCESS_URL, serverEnv().APP_URL).toString();
  const access = `People in the built-in roles can use ${them} straight away, with their usual access. Roles you created yourself need access given in Settings → Roles.`;
  const results = await Promise.all(
    input.recipients.map(async ({ email, fullName }) => {
      return sendEmail({
        to: email,
        subject: `New in Meroidea for ${input.businessName}: ${names}`,
        ...renderEmail({
          sender: { kind: 'platform' },
          preheader: `Now switched on for ${input.businessName}: ${names}.`,
          heading: `New for ${input.businessName}`,
          blocks: [
            { type: 'paragraph', text: `Hi ${fullName}, we have switched on more for your team:` },
            { type: 'list', items: input.labels },
            { type: 'paragraph', text: access },
            { type: 'button', label: `Review who can use ${them}`, url: link },
          ],
          reason: `You received this because you are an admin of ${input.businessName} on Meroidea.`,
        }),
      });
    }),
  );
  return results.every((result) => result.sent);
}

/**
 * Switches a business's features on and off. Its Admins are told about any switched on, in the
 * workspace and by email: a new menu item alone is easy to miss, and roles they made themselves
 * only get the new permissions when they grant them. Switching off is not announced.
 */
export async function setBusinessFeatures(
  admin: PlatformAdmin,
  input: { tenantId: string; features: FeatureKey[] },
): Promise<{ id: string; notified: number; emailed: boolean }> {
  const outcome = await adminDb().transaction(async (tx) => {
    const [before] = await tx
      .select({ name: tenants.name, status: tenants.status, features: tenants.features })
      .from(tenants)
      .where(eq(tenants.id, input.tenantId))
      .for('update')
      .limit(1);
    if (!before) throw new AppError('NOT_FOUND', 'That business was not found.');
    const previous = before.features.filter(isFeatureKey);
    const added = input.features.filter((key) => !previous.includes(key));
    const removed = previous.filter((key) => !input.features.includes(key));
    if (added.length === 0 && removed.length === 0) return null;

    await tx
      .update(tenants)
      .set({ features: input.features })
      .where(eq(tenants.id, input.tenantId));
    await tx.insert(auditLogs).values({
      tenantId: input.tenantId,
      actorUserId: admin.userId,
      actorType: 'platform',
      action: 'update',
      entityType: 'tenant',
      entityId: input.tenantId,
      changes: diffChanges({ features: previous }, { features: input.features }),
      context: { featuresAdded: added, featuresRemoved: removed },
    });
    if (added.length === 0 || !isTenantOpen(before.status)) return null;

    const admins = await tx
      .select({ userId: tenantMemberships.userId, email: users.email, fullName: users.fullName })
      .from(tenantMemberships)
      .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(
        and(
          eq(tenantMemberships.tenantId, input.tenantId),
          eq(tenantMemberships.status, 'active'),
          eq(tenantMemberships.isSupport, false),
          eq(roles.key, 'owner'),
          // The platform owner running their own business is not told about their own change.
          ne(tenantMemberships.userId, admin.userId),
        ),
      );
    const labels = FEATURES.filter((feature) => added.includes(feature.key)).map(
      (feature) => feature.label,
    );
    const { names, them } = featureWords(labels);
    await notify(
      tx,
      { tenantId: input.tenantId, userId: admin.userId },
      admins.map(({ userId }) => ({
        userId,
        type: 'features_enabled',
        title: `Now switched on: ${names}`,
        body: `Built-in roles can use ${them} straight away. Give roles you created yourself access in Settings → Roles.`,
        url: ROLE_ACCESS_URL,
      })),
    );
    return { businessName: before.name, labels, recipients: admins };
  });

  // Sent once the change is committed. Best effort: a failed email never undoes it, but the
  // console is told, so the platform owner can let the Admins know another way.
  const emailed =
    outcome && outcome.recipients.length > 0
      ? await emailFeaturesSwitchedOn(outcome).catch(() => false)
      : false;
  return { id: input.tenantId, notified: outcome?.recipients.length ?? 0, emailed };
}

/**
 * Sets where a business is. From then on its staff can only clock in and out within the radius;
 * clearing the location removes the restriction.
 */
export async function setBusinessLocation(
  admin: PlatformAdmin,
  input: SetLocationInput,
): Promise<{ id: string }> {
  const [updated] = await adminDb()
    .update(tenants)
    .set({
      locationLatitude: input.latitude || null,
      locationLongitude: input.longitude || null,
      clockRadiusMetres: input.radiusMetres,
    })
    .where(eq(tenants.id, input.tenantId))
    .returning({ id: tenants.id });
  if (!updated) throw new AppError('NOT_FOUND', 'That business was not found.');
  await record(input.tenantId, admin, {
    action: 'update',
    context: {
      clockLocation: input.latitude ? 'set' : 'cleared',
      radiusMetres: input.radiusMetres,
    },
  });
  return updated;
}

/**
 * Suspending keeps every record and locks the business's own people out until reactivated.
 * Reactivating a business whose admin has not yet accepted the service agreement returns it to
 * waiting for that, never straight to active.
 */
export async function setBusinessStatus(
  admin: PlatformAdmin,
  input: { tenantId: string; status: 'active' | 'suspended' },
): Promise<{ id: string }> {
  const db = adminDb();
  let status: 'active' | 'suspended' | 'awaiting_agreement' = input.status;
  if (input.status === 'active') {
    const [open] = await db
      .select({ id: tenantAgreements.id })
      .from(tenantAgreements)
      .where(
        and(eq(tenantAgreements.tenantId, input.tenantId), isNull(tenantAgreements.acceptedAt)),
      )
      .limit(1);
    if (open) status = 'awaiting_agreement';
  }
  const [updated] = await db
    .update(tenants)
    .set({ status })
    .where(eq(tenants.id, input.tenantId))
    .returning({ id: tenants.id });
  if (!updated) throw new AppError('NOT_FOUND', 'That business was not found.');
  await record(input.tenantId, admin, { action: 'update', context: { status } });
  return updated;
}

/**
 * Lets a platform owner into a business with full access, by giving them a temporary owner seat
 * marked as support. It is a real seat on purpose: the business sees it in its own team list and
 * audit log, and every rule that protects one business from another keeps applying unchanged.
 */
export async function startSupportAccess(admin: PlatformAdmin, tenantId: string): Promise<void> {
  const db = adminDb();
  const [owner] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.key, 'owner')))
    .limit(1);
  if (!owner) throw new AppError('NOT_FOUND', 'That business was not found.');

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: tenantMemberships.id, isSupport: tenantMemberships.isSupport })
      .from(tenantMemberships)
      .where(
        and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, admin.userId)),
      )
      .for('update')
      .limit(1);
    // Already a member in their own right (their own business): nothing to add.
    if (existing && !existing.isSupport) return;

    if (existing) {
      // A seat from an earlier visit, switched off when they left: switched back on.
      await tx
        .update(tenantMemberships)
        .set({ status: 'active', roleId: owner.id })
        .where(eq(tenantMemberships.id, existing.id));
    } else {
      await tx.insert(tenantMemberships).values({
        tenantId,
        userId: admin.userId,
        roleId: owner.id,
        status: 'active',
        isSupport: true,
      });
    }
    await tx.insert(auditLogs).values(supportAudit(tenantId, admin, 'started'));
  });
}

const supportAudit = (tenantId: string, admin: PlatformAdmin, step: 'started' | 'ended') => ({
  tenantId,
  actorUserId: admin.userId,
  actorType: 'platform' as const,
  action: 'permission_change' as const,
  entityType: 'tenant',
  entityId: tenantId,
  context: { supportAccess: step },
});

/**
 * Leaving switches the support seat off rather than deleting it. Anything the platform owner
 * created or was given while inside still points at the seat, so a delete would fail and leave
 * them with full access nobody in the business could remove; a switched-off seat grants nothing,
 * since access needs an active membership (loadTenantContext and app.tenant_ids()).
 */
export async function endSupportAccess(admin: PlatformAdmin, tenantId: string): Promise<void> {
  await adminDb().transaction(async (tx) => {
    const ended = await tx
      .update(tenantMemberships)
      .set({ status: 'deactivated' })
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.userId, admin.userId),
          eq(tenantMemberships.isSupport, true),
          eq(tenantMemberships.status, 'active'),
        ),
      )
      .returning({ id: tenantMemberships.id });
    if (ended.length > 0) await tx.insert(auditLogs).values(supportAudit(tenantId, admin, 'ended'));
  });
}
