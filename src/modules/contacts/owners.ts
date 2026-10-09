import type { PermissionKey } from '@/lib/permissions/catalog';
import { scopeDecision, type ScopeContext } from '@/lib/permissions/scope';
import type { MemberOption } from '@/modules/members/queries';

/** Colleagues this person may make owner of a record: themselves plus their assign scope. */
export function assignableOwners(
  ctx: ScopeContext,
  members: MemberOption[],
  permission: PermissionKey = 'contacts.assign',
) {
  const assign = scopeDecision(ctx, permission);
  return members
    .filter(
      (member) =>
        member.userId === ctx.userId ||
        assign.kind === 'all' ||
        (assign.kind === 'owners' && assign.userIds.includes(member.userId)),
    )
    .map((member) => ({
      value: member.userId,
      label: member.userId === ctx.userId ? `${member.fullName} (you)` : member.fullName,
    }));
}
