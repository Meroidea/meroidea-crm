import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import {
  auditLogs,
  roles,
  serviceAgreements,
  tenantAgreements,
  tenantMemberships,
  tenants,
} from '@/db/schema';
import { diffChanges } from '@/lib/audit-diff';
import { AppError } from '@/lib/errors';
import { isFeatureKey, type FeatureKey } from '@/lib/features';
import { provisionTenant } from '@/modules/tenants/provision';
import { createLinkToken } from '@/server/crypto';
import { adminDb } from '@/server/db/admin';
import { sendEmail } from '@/server/email';
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

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

export type AgreementLinkDelivery = {
  /** True when the link was emailed to the business's admin. */
  emailed: boolean;
  /** Returned only to the platform owner, to pass on when email is not set up. Never stored. */
  link: string;
};

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
  const intro = `Hi ${input.name}, ${input.businessName} has been set up on Meroidea and you are its admin.`;
  const step =
    'To open your workspace, read and accept the service agreement, then choose your password.';
  const closing = `This link works once and expires in ${AGREEMENT_LINK_DAYS} days. If you were not expecting it, ignore this email.`;
  const result = await sendEmail({
    to: input.to,
    subject: `Accept your Meroidea service agreement for ${input.businessName}`,
    text: [intro, step, `Read and accept: ${input.link}`, closing].join('\n\n'),
    html: `<p>${escapeHtml(intro)}</p><p>${escapeHtml(step)}</p><p><a href="${input.link}">Read and accept the agreement</a></p><p>${escapeHtml(closing)}</p>`,
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

  let tenantId: string;
  let token: string;
  try {
    ({ tenantId } = await provisionTenant({
      userId,
      companyName: input.companyName,
      industry: input.businessType,
      features: input.features,
      source: 'platform',
    }));
    const link = createLinkToken();
    token = link.token;
    await adminDb().transaction(async (tx) => {
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
    });
  } catch (cause) {
    // Don't leave a login behind for a business that was never created.
    await supabase.auth.admin.deleteUser(userId);
    throw cause;
  }

  const link = agreementUrl(token);
  const emailed = await emailAgreementLink({
    to: adminEmail,
    name: input.adminName,
    businessName: input.companyName,
    link,
  });
  return { tenantId, adminEmail, emailed, link };
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
  return { emailed, link: url };
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

export async function setBusinessFeatures(
  admin: PlatformAdmin,
  input: { tenantId: string; features: FeatureKey[] },
): Promise<{ id: string }> {
  const [updated] = await adminDb()
    .update(tenants)
    .set({ features: input.features })
    .where(eq(tenants.id, input.tenantId))
    .returning({ id: tenants.id });
  if (!updated) throw new AppError('NOT_FOUND', 'That business was not found.');
  await record(input.tenantId, admin, {
    action: 'update',
    context: { features: input.features },
  });
  return updated;
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

  const [existing] = await db
    .select({ id: tenantMemberships.id })
    .from(tenantMemberships)
    .where(
      and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, admin.userId)),
    )
    .limit(1);
  // Already a member in their own right (their own business): nothing to add.
  if (existing) return;

  await db.insert(tenantMemberships).values({
    tenantId,
    userId: admin.userId,
    roleId: owner.id,
    status: 'active',
    isSupport: true,
  });
  await record(tenantId, admin, {
    action: 'permission_change',
    context: { supportAccess: 'started' },
  });
}

export async function endSupportAccess(admin: PlatformAdmin, tenantId: string): Promise<void> {
  const removed = await adminDb()
    .delete(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.userId, admin.userId),
        eq(tenantMemberships.isSupport, true),
      ),
    )
    .returning({ id: tenantMemberships.id });
  if (removed.length > 0) {
    await record(tenantId, admin, {
      action: 'permission_change',
      context: { supportAccess: 'ended' },
    });
  }
}
