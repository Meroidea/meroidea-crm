import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { auditLogs, employees, roles, tenantMemberships, tenants, users } from '@/db/schema';
import { adminDb } from '@/server/db/admin';
import { sendEmail } from '@/server/email';
import { createSupabaseAdminClient } from '@/server/supabase/admin';
import { isPlatformOwnerEmail } from '@/server/platform';

import { businessTeamId, createPasswordLink, escapeHtml } from './service';

/*
 * Gives a new hire their login the moment they accept their offer (ADR-048). The person has no
 * session yet, so this uses the privileged connection. It is called only by the hiring module's
 * one-time link path after an acceptance has been committed, with the ids that path read from
 * the link's own contract, never with anything the caller typed.
 */

export type HireLoginResult =
  | { created: true; emailed: boolean }
  | {
      created: false;
      reason: 'not_requested' | 'already_linked' | 'role_unavailable' | 'email_in_use' | 'failed';
    };

function record(tenantId: string, employeeId: string, context: Record<string, unknown>) {
  return adminDb().insert(auditLogs).values({
    tenantId,
    actorUserId: null,
    actorType: 'employee_link',
    action: 'permission_change',
    entityType: 'employee',
    entityId: employeeId,
    context,
  });
}

/**
 * Links the staff record to an active login in the same business with the same email, unless
 * that login already belongs to another staff record. True when linked.
 */
async function linkExistingMember(tenantId: string, employeeId: string, email: string) {
  return adminDb().transaction(async (tx) => {
    const [member] = await tx
      .select({ userId: tenantMemberships.userId, membershipId: tenantMemberships.id })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.status, 'active'),
          eq(tenantMemberships.isSupport, false),
          sql`lower(${users.email}) = ${email}`,
        ),
      )
      .limit(1);
    if (!member) return false;
    const [taken] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.tenantId, tenantId),
          eq(employees.userId, member.userId),
          isNull(employees.deletedAt),
        ),
      )
      .limit(1);
    if (taken) return false;
    const [linked] = await tx
      .update(employees)
      .set({ userId: member.userId })
      .where(
        and(
          eq(employees.tenantId, tenantId),
          eq(employees.id, employeeId),
          isNull(employees.userId),
        ),
      )
      .returning({ id: employees.id });
    if (!linked) return false;
    await tx.insert(auditLogs).values({
      tenantId,
      actorUserId: null,
      actorType: 'employee_link',
      action: 'update',
      entityType: 'employee',
      entityId: employeeId,
      context: { linkedExistingLogin: true, membershipId: member.membershipId },
    });
    return true;
  });
}

/**
 * Creates the login, adds it to the business with the role chosen when they were hired and to
 * the business's team, links it to their employee record, and emails them a one-time link to
 * choose their password. Never throws for an expected reason: the acceptance it follows already
 * stands, and an admin can still give a login from the profile.
 */
export async function createLoginForAcceptedHire(input: {
  tenantId: string;
  employeeId: string;
  /** Who sent the contract; recorded as the person who invited them. */
  invitedBy: string | null;
}): Promise<HireLoginResult> {
  const db = adminDb();
  const [employee] = await db
    .select({
      email: employees.email,
      firstName: employees.firstName,
      lastName: employees.lastName,
      userId: employees.userId,
      loginRoleId: employees.loginRoleId,
      businessName: tenants.name,
    })
    .from(employees)
    .innerJoin(tenants, eq(tenants.id, employees.tenantId))
    .where(
      and(
        eq(employees.tenantId, input.tenantId),
        eq(employees.id, input.employeeId),
        isNull(employees.deletedAt),
      ),
    )
    .limit(1);
  if (!employee?.loginRoleId) return { created: false, reason: 'not_requested' };
  if (employee.userId) return { created: false, reason: 'already_linked' };

  // The Admin role is never handed out by hiring, whatever was stored.
  const [role] = await db
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .where(and(eq(roles.tenantId, input.tenantId), eq(roles.id, employee.loginRoleId)))
    .limit(1);
  if (!role || role.key === 'owner') {
    await record(input.tenantId, input.employeeId, { loginCreated: false, reason: 'role' });
    return { created: false, reason: 'role_unavailable' };
  }

  const email = employee.email.toLowerCase();
  // A platform owner's address never gets a login made by a business (see isPlatformOwnerEmail).
  if (isPlatformOwnerEmail(email)) {
    await record(input.tenantId, input.employeeId, { loginCreated: false, reason: 'email_in_use' });
    return { created: false, reason: 'email_in_use' };
  }
  const fullName = `${employee.firstName} ${employee.lastName}`;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    // Never used: they choose their own through the emailed link.
    password: randomBytes(24).toString('base64url'),
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) {
    // One email holds one login (ADR-031). When that login is already one of this business's own
    // people (an admin added them before they accepted), link the staff record to it instead.
    if (await linkExistingMember(input.tenantId, input.employeeId, email)) {
      return { created: false, reason: 'already_linked' };
    }
    await record(input.tenantId, input.employeeId, { loginCreated: false, reason: 'email_in_use' });
    return { created: false, reason: 'email_in_use' };
  }
  const userId = data.user.id;

  try {
    await db.transaction(async (tx) => {
      const [membership] = await tx
        .insert(tenantMemberships)
        .values({
          tenantId: input.tenantId,
          userId,
          roleId: role.id,
          teamId: await businessTeamId(tx, input.tenantId),
          status: 'active',
          invitedBy: input.invitedBy,
        })
        .returning({ id: tenantMemberships.id });
      if (!membership) throw new Error('membership not created');
      const [linked] = await tx
        .update(employees)
        .set({ userId })
        .where(
          and(
            eq(employees.tenantId, input.tenantId),
            eq(employees.id, input.employeeId),
            // Someone may have linked a login by hand in the meantime; theirs stands.
            isNull(employees.userId),
          ),
        )
        .returning({ id: employees.id });
      if (!linked) throw new Error('employee already linked');
      await tx.insert(auditLogs).values({
        tenantId: input.tenantId,
        actorUserId: null,
        actorType: 'employee_link',
        action: 'permission_change',
        entityType: 'membership',
        entityId: membership.id,
        context: { loginCreated: true, fromHire: input.employeeId, roleId: role.id },
      });
    });
  } catch (cause) {
    // Don't leave a login behind for someone who was never added.
    await supabase.auth.admin.deleteUser(userId);
    console.error('[hire-login] failed', {
      name: cause instanceof Error ? cause.name : typeof cause,
    });
    await record(input.tenantId, input.employeeId, { loginCreated: false, reason: 'failed' });
    return { created: false, reason: 'failed' };
  }

  const link = await createPasswordLink(email);
  if (!link) return { created: true, emailed: false };
  const intro = `Hi ${employee.firstName}, welcome to ${employee.businessName}. You now have a login to see your roster, payslips, time and tasks.`;
  const closing =
    'This link works once and expires soon. If it has expired, use “Forgot password” on the sign-in page with this email address.';
  const result = await sendEmail({
    to: email,
    subject: `Your login for ${employee.businessName}`,
    text: [intro, `Choose your password: ${link}`, closing].join('\n\n'),
    html: `<p>${escapeHtml(intro)}</p><p><a href="${link}">Choose your password</a></p><p>${escapeHtml(closing)}</p>`,
  });
  return { created: true, emailed: result.sent };
}
