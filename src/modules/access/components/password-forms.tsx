'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestPasswordResetAction, setPasswordAction } from '@/modules/access/actions';

export function SetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await setPasswordAction({ password, confirm });
          if (!result.ok) {
            return setError(
              Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message,
            );
          }
          router.replace('/dashboard');
          router.refresh();
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">At least 10 characters.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm-password">Type it again</Label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={isPending}>
        Save password
      </Button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<{ emailAvailable: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (done) {
    return (
      <div className="flex flex-col gap-3 text-center text-sm">
        <p>
          {done.emailAvailable
            ? 'If that address has a login, a link to choose a new password is on its way. It works once and expires soon.'
            : 'Password reset by email is not available yet. Ask your workspace admin to send you a new password link.'}
        </p>
        <Link href="/login" className="text-primary underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await requestPasswordResetAction({ email });
          if (!result.ok)
            return setError(result.error.fieldErrors?.email?.[0] ?? result.error.message);
          setDone(result.data);
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset-email">Work email</Label>
        <Input
          id="reset-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={isPending}>
        Send me a link
      </Button>
    </form>
  );
}
