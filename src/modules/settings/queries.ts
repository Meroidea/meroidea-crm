import 'server-only';

import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';

import {
  leadSources,
  lostReasons,
  roles,
  serviceAgreements,
  teams,
  tenantAgreements,
  tenantMemberships,
  users,
} from '@/db/schema';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

export async function getSettingsLists(ctx: TenantContext) {
  requirePermission(ctx, 'settings.manage');
  return withRls(ctx, async (tx) => {
    const [sources, reasons, members, roleRows] = await Promise.all([
      tx
        .select({
          id: leadSources.id,
          name: leadSources.name,
          type: leadSources.type,
          isActive: leadSources.isActive,
        })
        .from(leadSources)
        .where(eq(leadSources.tenantId, ctx.tenantId))
        .orderBy(asc(leadSources.position), asc(leadSources.name)),
      tx
        .select({ id: lostReasons.id, name: lostReasons.name, isActive: lostReasons.isActive })
        .from(lostReasons)
        .where(eq(lostReasons.tenantId, ctx.tenantId))
        .orderBy(asc(lostReasons.position), asc(lostReasons.name)),
      tx
        .select({
          userId: tenantMemberships.userId,
          fullName: users.fullName,
          email: users.email,
          status: tenantMemberships.status,
          roleId: tenantMemberships.roleId,
          roleName: roles.name,
          teamName: teams.name,
          lastSeenAt: tenantMemberships.lastSeenAt,
        })
        .from(tenantMemberships)
        .innerJoin(users, eq(users.id, tenantMemberships.userId))
        .innerJoin(
          roles,
          and(
            eq(roles.tenantId, tenantMemberships.tenantId),
            eq(roles.id, tenantMemberships.roleId),
          ),
        )
        .leftJoin(
          teams,
          and(
            eq(teams.tenantId, tenantMemberships.tenantId),
            eq(teams.id, tenantMemberships.teamId),
          ),
        )
        .where(eq(tenantMemberships.tenantId, ctx.tenantId))
        .orderBy(asc(users.fullName)),
      tx
        .select({ id: roles.id, name: roles.name, key: roles.key })
        .from(roles)
        .where(eq(roles.tenantId, ctx.tenantId))
        .orderBy(asc(roles.name)),
    ]);
    return { sources, reasons, members, roles: roleRows };
  });
}

/** The service agreement this business accepted most recently, or null (ADR-047). */
export async function getAcceptedAgreement(ctx: TenantContext) {
  requirePermission(ctx, 'settings.manage');
  const [row] = await withRls(ctx, (tx) =>
    tx
      .select({
        title: serviceAgreements.title,
        version: serviceAgreements.version,
        acceptedName: tenantAgreements.acceptedName,
        acceptedAt: tenantAgreements.acceptedAt,
      })
      .from(tenantAgreements)
      .innerJoin(serviceAgreements, eq(serviceAgreements.id, tenantAgreements.agreementId))
      .where(
        and(eq(tenantAgreements.tenantId, ctx.tenantId), isNotNull(tenantAgreements.acceptedAt)),
      )
      .orderBy(desc(tenantAgreements.acceptedAt))
      .limit(1),
  );
  return row ?? null;
}
