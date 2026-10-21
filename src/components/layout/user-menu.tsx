'use client';

import { ChevronDown, KeyRound, LogOut, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Avatar } from '@/components/data/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOutAction } from '@/modules/auth/actions';

/** The signed-in person's menu: who they are, their details, password and sign out. */
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

  function signOut() {
    startTransition(async () => {
      await signOutAction();
      router.replace('/login');
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${name}`}
        className="group ml-1 flex items-center gap-2 rounded-full p-0.5 pr-1.5 transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:bg-accent sm:pr-2"
      >
        <Avatar
          name={name}
          className="size-8 text-xs ring-2 ring-background transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none"
        />
        <span className="hidden max-w-40 text-left leading-tight sm:block">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">{roleName}</span>
        </span>
        <ChevronDown
          aria-hidden
          className="hidden size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none sm:block"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-64 p-1.5">
        <DropdownMenuLabel className="flex items-center gap-3 px-2 py-2 font-normal">
          <Avatar name={name} className="size-10 text-sm" />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-semibold text-foreground">{name}</span>
            <span className="block truncate text-xs text-muted-foreground" data-sensitive>
              {email}
            </span>
            <span className="mt-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              {roleName}
            </span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild className="py-2">
            <Link href="/profile">
              <UserRound aria-hidden /> My details
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="py-2">
            <Link href="/set-password">
              <KeyRound aria-hidden /> Change password
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="py-2"
          disabled={isPending}
          onSelect={(event) => {
            event.preventDefault();
            signOut();
          }}
        >
          <LogOut aria-hidden /> {isPending ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
