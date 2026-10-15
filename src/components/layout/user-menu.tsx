'use client';

import { KeyRound, LogOut } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Avatar } from '@/components/data/avatar';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { signOutAction } from '@/modules/auth/actions';

export function UserMenu({
  name,
  email,
  roleName,
}: {
  name: string;
  email: string;
  roleName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-1">
      <div className="mr-2 ml-1 hidden items-center gap-2.5 sm:flex" title={email}>
        <Avatar name={name} className="size-8 text-xs" />
        <div className="max-w-48 leading-tight">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{roleName}</p>
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild variant="ghost" size="icon" aria-label="Change password">
            <Link href="/set-password">
              <KeyRound aria-hidden />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Change password</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
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
        </TooltipTrigger>
        <TooltipContent>Sign out</TooltipContent>
      </Tooltip>
    </div>
  );
}
