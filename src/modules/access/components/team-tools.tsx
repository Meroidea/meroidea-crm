'use client';

import { Check, Copy, KeyRound, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  inviteMemberAction,
  sendPasswordLinkAction,
  setMemberStatusAction,
} from '@/modules/access/actions';

type Role = { id: string; name: string; key: string };
type Delivery = { emailed: boolean; link: string; name: string };

/**
 * What happened to a password link. When email is not set up the link is shown once, for the
 * admin to pass on themselves; it is never stored or shown again.
 */
export function LinkResult({ delivery, onDone }: { delivery: Delivery; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-accent px-3 py-3 text-sm"
    >
      {delivery.emailed ? (
        <p>
          A link to choose a password has been emailed to <strong>{delivery.name}</strong>. It works
          once and expires soon.
        </p>
      ) : (
        <>
          <p>
            Email is not set up, so nothing was sent. Copy this link and give it to{' '}
            <strong>{delivery.name}</strong> yourself. It works once, expires soon, and will not be
            shown again.
          </p>
          <div className="flex gap-2">
            <Input readOnly value={delivery.link} aria-label="Password link" data-sensitive />
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(delivery.link);
                setCopied(true);
              }}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </>
      )}
      <div>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

/** Adds a person with a login. `employee` pre-fills and links a staff record. */
export function InviteMember({
  roles,
  employee,
}: {
  roles: Role[];
  employee?: { id: string; fullName: string; email: string | null };
}) {
  const router = useRouter();
  const defaultRole = roles.find((role) => role.key === 'member') ?? roles[0];
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState(employee?.fullName ?? '');
  const [email, setEmail] = useState(employee?.email ?? '');
  const [roleId, setRoleId] = useState(defaultRole?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [isPending, startTransition] = useTransition();

  if (delivery) {
    return (
      <LinkResult
        delivery={delivery}
        onDone={() => {
          setDelivery(null);
          setOpen(false);
          router.refresh();
        }}
      />
    );
  }

  if (!open) {
    return (
      <div>
        <Button
          type="button"
          variant={employee ? 'outline' : 'default'}
          onClick={() => setOpen(true)}
        >
          <UserPlus aria-hidden />
          {employee ? 'Give them a login' : 'Add a person'}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await inviteMemberAction({
            fullName,
            email,
            roleId,
            ...(employee ? { employeeId: employee.id } : {}),
          });
          if (!result.ok) {
            return setError(
              Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message,
            );
          }
          setDelivery({ emailed: result.data.emailed, link: result.data.link, name: fullName });
          if (!employee) {
            setFullName('');
            setEmail('');
          }
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-name">Full name</Label>
          <Input
            id="invite-name"
            required
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <NativeSelect
            id="invite-role"
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        They get a one-time link to choose their own password. You never see or set it.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Adding…' : 'Add and send link'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Per-person controls in the team list: a new password link, and switching the login off or on. */
export function MemberAccess({
  userId,
  name,
  status,
  isSelf,
  onError,
  onDelivery,
}: {
  userId: string;
  name: string;
  status: 'invited' | 'active' | 'deactivated';
  isSelf: boolean;
  onError: (message: string | null) => void;
  onDelivery: (delivery: Delivery) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-1.5">
      {status !== 'deactivated' && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              onError(null);
              const result = await sendPasswordLinkAction({ userId });
              if (!result.ok) return onError(result.error.message);
              onDelivery({ ...result.data, name });
            })
          }
        >
          <KeyRound aria-hidden />
          Password link
        </Button>
      )}
      {!isSelf && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              onError(null);
              const result = await setMemberStatusAction({
                userId,
                status: status === 'deactivated' ? 'active' : 'deactivated',
              });
              if (!result.ok) onError(result.error.message);
              router.refresh();
            })
          }
        >
          {status === 'deactivated' ? 'Reactivate' : 'Deactivate'}
        </Button>
      )}
    </div>
  );
}
