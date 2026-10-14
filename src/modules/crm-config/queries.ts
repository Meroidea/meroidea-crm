import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import {
  emailTemplates,
  rolePermissions,
  roles,
  routingRules,
  sequences,
  teams,
  tenantMemberships,
  webForms,
} from '@/db/schema';
import { requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';

import type { RuleConditions } from '@/modules/leads/routing';

export async function getRoutingRules(ctx: TenantContext) {
  requirePermission(ctx, 'settings.manage');
  return withRls(ctx, async (tx) => {
    const rows = await tx
      .select()
      .from(routingRules)
      .where(eq(routingRules.tenantId, ctx.tenantId))
      .orderBy(asc(routingRules.position), asc(routingRules.createdAt));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      stage: row.stage as 'intake' | 'handover',
      leadType: row.leadType,
      method: row.method as 'round_robin' | 'least_loaded',
      userIds: row.userIds,
      teamId: row.teamId,
      conditions: row.conditions as RuleConditions,
      isActive: row.isActive,
    }));
  });
}

export async function getTeams(ctx: TenantContext) {
  return withRls(ctx, (tx) =>
    tx
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.tenantId, ctx.tenantId))
      .orderBy(asc(teams.name)),
  );
}

export async function getEmailTemplates(ctx: TenantContext, activeOnly = false) {
  return withRls(ctx, (tx) =>
    tx
      .select({
        id: emailTemplates.id,
        name: emailTemplates.name,
        subject: emailTemplates.subject,
        body: emailTemplates.body,
        isActive: emailTemplates.isActive,
      })
      .from(emailTemplates)
      .where(
        and(
          eq(emailTemplates.tenantId, ctx.tenantId),
          activeOnly ? eq(emailTemplates.isActive, true) : undefined,
        ),
      )
      .orderBy(asc(emailTemplates.name)),
  );
}

export type SequenceStep = {
  id: string;
  day: number;
  type: 'email' | 'call' | 'meeting' | 'follow_up' | 'other';
  title: string;
  templateId: string | null;
};

export async function getSequences(ctx: TenantContext, activeOnly = false) {
  const rows = await withRls(ctx, (tx) =>
    tx
      .select()
      .from(sequences)
      .where(
        and(
          eq(sequences.tenantId, ctx.tenantId),
          activeOnly ? eq(sequences.isActive, true) : undefined,
        ),
      )
      .orderBy(asc(sequences.name)),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    steps: (Array.isArray(row.steps) ? row.steps : []) as SequenceStep[],
    isActive: row.isActive,
  }));
}

export async function getWebForms(ctx: TenantContext) {
  requirePermission(ctx, 'settings.manage');
  return withRls(ctx, (tx) =>
    tx
      .select()
      .from(webForms)
      .where(eq(webForms.tenantId, ctx.tenantId))
      .orderBy(asc(webForms.name)),
  );
}

/** Roles with their grants and how many people hold each, for the roles editor. */
export async function getRolesWithGrants(ctx: TenantContext) {
  requirePermission(ctx, 'roles.manage');
  return withRls(ctx, async (tx) => {
    const [roleRows, grantRows, memberRows] = await Promise.all([
      tx.select().from(roles).where(eq(roles.tenantId, ctx.tenantId)).orderBy(asc(roles.name)),
      tx
        .select({
          roleId: rolePermissions.roleId,
          permission: rolePermissions.permission,
          scope: rolePermissions.scope,
        })
        .from(rolePermissions)
        .where(eq(rolePermissions.tenantId, ctx.tenantId)),
      tx
        .select({ roleId: tenantMemberships.roleId })
        .from(tenantMemberships)
        .where(eq(tenantMemberships.tenantId, ctx.tenantId)),
    ]);
    return roleRows
      .filter((role) => role.key !== 'support')
      .map((role) => ({
        id: role.id,
        key: role.key,
        name: role.name,
        description: role.description,
        people: memberRows.filter((member) => member.roleId === role.id).length,
        grants: Object.fromEntries(
          grantRows
            .filter((grant) => grant.roleId === role.id)
            .map((grant) => [grant.permission, grant.scope ?? 'true']),
        ) as Record<string, 'own' | 'team' | 'all' | 'true'>,
      }));
  });
}
