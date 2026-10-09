import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, count, eq } from 'drizzle-orm';

import { roles, tenantMemberships, users } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { linkEmployeeLogin } from '@/modules/hiring/staff-service';
import { audit } from '@/server/audit';
import { hasPermission, requirePermission, type TenantContext } from '@/server/context';
import { withRls } from '@/server/db/with-rls';
import { isEmailConfigured, sendEmail } from '@/server/email';
import { serverEnv } from '@/server/env';
import { createSupabaseAdminClient } from '@/server/supabase/admin';

import type { InviteMemberInput } from './schemas';

/**
 * A one-time link that signs its owner in and takes them to choose a password. It is issued by
 * the auth server, single-use and short-lived; we deliver it ourselves (ADR-023) instead of
 * using the auth server's built-in mailer.
 */
async function createPasswordLink(email: string): Promise<string | null> {
  const { data, error } = await createSupabaseAdminClient().auth.admin.generateLink({
    type: 'recovery',
    email,
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return null;
  const url = new URL('/auth/confirm', serverEnv().APP_URL);
  url.searchParams.set('token_hash', tokenHash);
  url.searchParams.set('type', 'recovery');
  return url.toString();
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

async function emailPasswordLink(input: {
  to: string;
  link: string;
  heading: string;
  intro: string;
}): Promise<boolean> {
  const closing =
    'This link works once and expires soon. If you were not expecting it, ignore this email.';
  const result = await sendEmail({
    to: input.to,
    subject: input.heading,
    text: [input.intro, `Choose your password: ${input.link}`, closing].join('\n\n'),
    html: `<p>${escapeHtml(input.intro)}</p><p><a href="${input.link}">Choose your password</a></p><p>${closing}</p>`,
  });
  return result.sent;
}

export type LinkDelivery = {
  /** True when the link was emailed. */
  emailed: boolean;
  /** Returned only to the admin who asked, so it can be passed on when email is not set up. */
  link: string;
};

/**
 * Adds someone to the business with a login and a role, and gives them a link to set their own
 * password. Nobody ever knows or chooses another person's password.
 */
export async function inviteMember(
  ctx: TenantContext,
  input: InviteMemberInput,
): Promise<LinkDelivery & { userId: string }> {
  requirePermission(ctx, 'users.manage');
  if (input.employeeId && !hasPermission(ctx, 'employees.manage')) {
    throw new AppError('FORBIDDEN', 'You do not have access to that.');
  }
  const email = input.email.toLowerCase();
  const [role] = await withRls(ctx, (tx) =>
    tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, ctx.tenantId), eq(roles.id, input.roleId)))
      .limit(1),
  );
  if (!role) throw new AppError('VALIDATION', 'Choose a role.', { roleId: ['Choose a role'] });

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    // Never used: the person chooses their own through the link.
    password: randomBytes(24).toString('base64url'),
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });
  if (error || !data.user) {
    throw new AppError('CONFLICT', 'That email address already has a login.', {
      email: ['This email already has a login'],
    });
  }
  const userId = data.user.id;

  try {
    await withRls(ctx, async (tx) => {
      const [membership] = await tx
        .insert(tenantMemberships)
        .values({
          tenantId: ctx.tenantId,
          userId,
          roleId: role.id,
          status: 'active',
          invitedBy: ctx.userId,
        })
        .returning({ id: tenantMemberships.id });
      if (!membership) throw new AppError('INTERNAL', 'Could not add that person.');
      await audit(tx, ctx, {
        action: 'permission_change',
        entityType: 'membership',
        entityId: membership.id,
        context: { invited: true, roleId: role.id },
      });
    });
    if (input.employeeId) {
      await linkEmployeeLogin(ctx, { employeeId: input.employeeId, userId });
    }
  } catch (cause) {
    // Don't leave a login behind for someone who was never added.
    await supabase.auth.admin.deleteUser(userId);
    throw cause;
  }

  const link = await createPasswordLink(email);
  if (!link)
    throw new AppError(
      'INTERNAL',
      'They were added, but a sign-in link could not be made. Send one from the team list.',
    );
  const emailed = await emailPasswordLink({
    to: email,
    link,
    heading: `You have been added to ${ctx.tenant.name}`,
    intro: `Hi ${input.fullName}, ${ctx.tenant.name} has given you a login.`,
  });
  return { userId, emailed, link };
}

async function memberEmail(ctx: TenantContext, userId: string) {
  const [member] = await withRls(ctx, (tx) =>
    tx
      .select({
        id: tenantMemberships.id,
        email: users.email,
        fullName: users.fullName,
        roleId: tenantMemberships.roleId,
        status: tenantMemberships.status,
        isSupport: tenantMemberships.isSupport,
      })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(
        and(eq(tenantMemberships.tenantId, ctx.tenantId), eq(tenantMemberships.userId, userId)),
      )
      .limit(1),
  );
  // Someone outside this business is "not found", never "forbidden".
  if (!member || member.isSupport) throw new AppError('NOT_FOUND', 'That person was not found.');
  return member;
}

/** A fresh link for one of the business's own people to choose a new password. */
export async function sendPasswordLink(ctx: TenantContext, userId: string): Promise<LinkDelivery> {
  requirePermission(ctx, 'users.manage');
  const member = await memberEmail(ctx, userId);
  const link = await createPasswordLink(member.email);
  if (!link) throw new AppError('INTERNAL', 'A sign-in link could not be made. Try again.');
  const emailed = await emailPasswordLink({
    to: member.email,
    link,
    heading: `Choose a new password for ${ctx.tenant.name}`,
    intro: `Hi ${member.fullName}, here is a link to choose a new password.`,
  });
  await withRls(ctx, (tx) =>
    audit(tx, ctx, {
      action: 'permission_change',
      entityType: 'membership',
      entityId: member.id,
      context: { passwordLinkSent: true },
    }),
  );
  return { emailed, link };
}

/** Deactivating keeps the person's records and history but stops them signing in to this business. */
export async function setMemberStatus(
  ctx: TenantContext,
  input: { userId: string; status: 'active' | 'deactivated' },
): Promise<{ id: string }> {
  requirePermission(ctx, 'users.manage');
  if (input.userId === ctx.userId) {
    throw new AppError('CONFLICT', 'You cannot deactivate your own login.');
  }
  const member = await memberEmail(ctx, input.userId);
  if (member.status === input.status) return { id: member.id };

  return withRls(ctx, async (tx) => {
    if (input.status === 'deactivated') {
      const [ownerRole] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.tenantId, ctx.tenantId), eq(roles.key, 'owner')))
        .limit(1);
      if (ownerRole && member.roleId === ownerRole.id) {
        const [owners] = await tx
          .select({ total: count() })
          .from(tenantMemberships)
          .where(
            and(
              eq(tenantMemberships.tenantId, ctx.tenantId),
              eq(tenantMemberships.roleId, ownerRole.id),
              eq(tenantMemberships.status, 'active'),
              eq(tenantMemberships.isSupport, false),
            ),
          );
        if ((owners?.total ?? 0) <= 1) {
          throw new AppError('CONFLICT', 'The workspace needs at least one active owner.');
        }
      }
    }
    await tx
      .update(tenantMemberships)
      .set({ status: input.status })
      .where(eq(tenantMemberships.id, member.id));
    await audit(tx, ctx, {
      action: 'permission_change',
      entityType: 'membership',
      entityId: member.id,
      changes: { status: [member.status, input.status] },
    });
    return { id: member.id };
  });
}

/**
 * "Forgot my password" from the sign-in page. Says nothing about whether the address has a
 * login: the answer is the same either way, and only the email (if any) differs.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  if (!isEmailConfigured()) return;
  const link = await createPasswordLink(email.toLowerCase());
  if (!link) return;
  await emailPasswordLink({
    to: email.toLowerCase(),
    link,
    heading: 'Choose a new password',
    intro: 'Someone asked to reset the password for this email address.',
  });
}
