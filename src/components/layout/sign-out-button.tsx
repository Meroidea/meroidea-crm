'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { signOutAction } from '@/modules/auth/actions';

/** A plain sign-out, for pages outside the workspace such as a suspended business's notice. */
export function SignOutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await signOutAction();
          router.replace('/login');
          router.refresh();
        })
      }
    >
      <LogOut aria-hidden /> Sign out
    </Button>
  );
}
