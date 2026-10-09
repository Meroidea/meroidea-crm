'use client';

import { KeyRound, LogOut } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { signOutAction } from '@/modules/auth/actions';

export function UserMenu({ email, roleName }: { email: string; roleName: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right leading-tight sm:block">
        <p className="text-sm font-medium">{email}</p>
        <p className="text-xs text-muted-foreground">{roleName}</p>
      </div>
      <Button asChild variant="ghost" size="icon" aria-label="Change password">
        <Link href="/set-password">
          <KeyRound aria-hidden />
        </Link>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Sign out"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await signOutAction();
            router.replace('/login');
            router.refresh();
          })
        }
      >
        <LogOut aria-hidden />
      </Button>
    </div>
  );
}
