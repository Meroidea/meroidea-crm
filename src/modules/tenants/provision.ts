import 'server-only';

import { eq } from 'drizzle-orm';

import {
  auditLogs,
  leadReasons,
  leadSources,
  leadStatuses,
  leadSubSources,
  leaveTypes,
  lostReasons,
  pipelineStages,
  pipelines,
  rolePermissions,
  roles,
  teams,
  tenantMemberships,
  tenantSubscriptions,
  tenants,
} from '@/db/schema';
import { DEFAULT_ROLES } from '@/lib/permissions/catalog';
import { DEFAULT_LEAVE_TYPES } from '@/modules/timeoff/defaults';
import {
  DEFAULT_LEAD_REASONS,
  DEFAULT_LEAD_SOURCES,
  DEFAULT_LEAD_STATUSES,
  DEFAULT_LOST_REASONS,
  DEFAULT_PIPELINE,
} from '@/lib/tenant/defaults';
import { AppError } from '@/lib/errors';
import { uniqueSlug } from '@/lib/tenant/slug';
import { adminDb } from '@/server/db/admin';

/** Whether this person already has a workspace, so sign-up stays idempotent. */
export async function findWorkspaceForUser(userId: string): Promise<{ tenantId: string } | null> {
  const [existing] = await adminDb()
    .select({ tenantId: tenantMemberships.tenantId })
    .from(tenantMemberships)
    .where(eq(tenantMemberships.userId, userId))
    .limit(1);
  return existing ? { tenantId: existing.tenantId } : null;
}

export type ProvisionTenantInput = {
  userId: string;
  companyName: string;
  industry?: string | null;
  timezone?: string;
  currency?: string;
  country?: string | null;
  /** Features to switch on; a business starts with none unless the platform owner chooses. */
  features?: string[];
  /** Who created the business, for its audit log. */
  source?: 'signup' | 'platform';
  /**
   * More writes that belong to creating this business, run inside the same transaction, so a
   * failure in any of them leaves no half-made business behind (ADR-047).
   */
  finish?: (tx: ProvisionTx, tenantId: string) => Promise<void>;
};

type Db = ReturnType<typeof adminDb>;
export type ProvisionTx = Parameters<Parameters<Db['transaction']>[0]>[0];

const TRIAL_DAYS = 14;

/**
 * Creates a workspace in one transaction: tenant, default roles and their grants, a first team,
 * the owner's membership, starting lead sources, a sales pipeline with lost reasons, a trial subscription and an audit entry. If any step fails, no
 * half-built workspace is left behind (docs/onboarding.md §3).
 *
 * Uses adminDb deliberately: at this moment the person has no membership, so RLS would deny
 * every insert. Nothing here is driven by unvalidated user input beyond the company name.
 */
export async function provisionTenant(
  input: ProvisionTenantInput,
): Promise<{ tenantId: string; slug: string }> {
  const db = adminDb();

  const slug = await uniqueSlug(input.companyName, async (candidate) => {
    const [existing] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, candidate))
      .limit(1);
    return Boolean(existing);
  });

  return db.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(tenants)
      .values({
        name: input.companyName,
        slug,
        status: 'trialing',
        industry: input.industry ?? null,
        timezone: input.timezone ?? 'Australia/Sydney',
        defaultCurrency: input.currency ?? 'AUD',
        defaultCountry: input.country ?? 'AU',
        features: input.features ?? [],
        onboarding: { brand: false, pipeline: false, invite: false, import: false },
      })
      .returning({ id: tenants.id, slug: tenants.slug });

    if (!tenant) throw new AppError('INTERNAL', 'Could not create the workspace.');

    const createdRoles = await tx
      .insert(roles)
      .values(
        DEFAULT_ROLES.map((role) => ({
          tenantId: tenant.id,
          key: role.key,
          name: role.name,
          description: role.description,
          isSystem: role.isSystem,
        })),
      )
      .returning({ id: roles.id, key: roles.key });

    const grants = DEFAULT_ROLES.flatMap((definition) => {
      const role = createdRoles.find((candidate) => candidate.key === definition.key);
      if (!role) return [];
      return Object.entries(definition.grants).map(([permission, grant]) => ({
        tenantId: tenant.id,
        roleId: role.id,
        permission,
        scope: grant === true ? null : grant,
      }));
    });
    await tx.insert(rolePermissions).values(grants);

    const [team] = await tx
      .insert(teams)
      .values({ tenantId: tenant.id, name: input.companyName, managerUserId: input.userId })
      .returning({ id: teams.id });

    const ownerRole = createdRoles.find((role) => role.key === 'owner');
    if (!ownerRole || !team) throw new AppError('INTERNAL', 'Could not create the workspace.');

    await tx.insert(tenantMemberships).values({
      tenantId: tenant.id,
      userId: input.userId,
      roleId: ownerRole.id,
      teamId: team.id,
      status: 'active',
    });

    const createdSources = await tx
      .insert(leadSources)
      .values(
        DEFAULT_LEAD_SOURCES.map(({ name, type }, position) => ({
          tenantId: tenant.id,
          name,
          type,
          position,
        })),
      )
      .returning({ id: leadSources.id, name: leadSources.name });
    const subSources = DEFAULT_LEAD_SOURCES.flatMap((source) => {
      const sourceId = createdSources.find((created) => created.name === source.name)?.id;
      return sourceId
        ? source.subSources.map((name, position) => ({
            tenantId: tenant.id,
            sourceId,
            name,
            position,
          }))
        : [];
    });
    if (subSources.length > 0) await tx.insert(leadSubSources).values(subSources);
    await tx.insert(leadStatuses).values(
      DEFAULT_LEAD_STATUSES.map((status, position) => ({
        tenantId: tenant.id,
        ...status,
        position,
      })),
    );
    await tx.insert(leadReasons).values(
      (['disqualify', 'reject'] as const).flatMap((kind) =>
        DEFAULT_LEAD_REASONS[kind].map((name, position) => ({
          tenantId: tenant.id,
          kind,
          name,
          position,
        })),
      ),
    );

    const [pipeline] = await tx
      .insert(pipelines)
      .values({ tenantId: tenant.id, name: DEFAULT_PIPELINE.name, isDefault: true })
      .returning({ id: pipelines.id });
    if (!pipeline) throw new AppError('INTERNAL', 'Could not create the workspace.');
    await tx.insert(pipelineStages).values(
      DEFAULT_PIPELINE.stages.map((stage, position) => ({
        tenantId: tenant.id,
        pipelineId: pipeline.id,
        position,
        ...stage,
      })),
    );
    await tx
      .insert(lostReasons)
      .values(
        DEFAULT_LOST_REASONS.map((name, position) => ({ tenantId: tenant.id, name, position })),
      );
    await tx
      .insert(leaveTypes)
      .values(DEFAULT_LEAVE_TYPES.map((type) => ({ tenantId: tenant.id, ...type })));

    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    await tx.insert(tenantSubscriptions).values({
      tenantId: tenant.id,
      planCode: 'trial',
      status: 'trialing',
      seats: 1,
      trialEndsAt,
    });

    await tx.insert(auditLogs).values({
      tenantId: tenant.id,
      actorUserId: input.userId,
      actorType: 'user',
      action: 'create',
      entityType: 'tenant',
      entityId: tenant.id,
      context: { source: input.source ?? 'signup', slug: tenant.slug },
    });

    await input.finish?.(tx, tenant.id);
    return { tenantId: tenant.id, slug: tenant.slug };
  });
}
