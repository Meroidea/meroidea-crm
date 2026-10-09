'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Avatar } from '@/components/data/avatar';
import { NativeSelect } from '@/components/forms/native-select';
import { Badge } from '@/components/ui/badge';
import { InviteMember, LinkResult, MemberAccess } from '@/modules/access/components/team-tools';
import { changeMemberRoleAction } from '@/modules/settings/actions';

type Member = {
  userId: string;
  fullName: string;
  email: string;
  status: 'invited' | 'active' | 'deactivated';
  roleId: string;
  roleName: string;
  teamName: string | null;
};

export function TeamTable({
  members,
  roles,
  canManage,
  currentUserId,
}: {
  members: Member[];
  roles: { id: string; name: string; key: string }[];
  canManage: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [delivery, setDelivery] = useState<{ emailed: boolean; link: string; name: string } | null>(
    null,
  );

  return (
    <div className="flex flex-col gap-3">
      {canManage && <InviteMember roles={roles} />}
      {delivery && <LinkResult delivery={delivery} onDone={() => setDelivery(null)} />}
      {error && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
        >
          {error}
        </p>
      )}
      <ul className="flex flex-col divide-y rounded-xl border bg-card">
        {members.map((member) => (
          <li key={member.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Avatar name={member.fullName} className="size-9 text-xs" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {member.fullName}
                {member.userId === currentUserId && (
                  <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                )}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {member.email}
                {member.teamName && ` · ${member.teamName}`}
              </p>
            </div>
            {member.status !== 'active' && <Badge variant="outline">{member.status}</Badge>}
            {canManage ? (
              <NativeSelect
                aria-label={`Role for ${member.fullName}`}
                value={member.roleId}
                disabled={isPending}
                onChange={(event) =>
                  startTransition(async () => {
                    setError(null);
                    const result = await changeMemberRoleAction({
                      userId: member.userId,
                      roleId: event.target.value,
                    });
                    if (!result.ok) setError(result.error.message);
                    router.refresh();
                  })
                }
                className="h-8 w-auto"
              >
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Badge variant="secondary">{member.roleName}</Badge>
            )}
            {canManage && (
              <MemberAccess
                userId={member.userId}
                name={member.fullName}
                status={member.status}
                isSelf={member.userId === currentUserId}
                onError={setError}
                onDelivery={setDelivery}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
