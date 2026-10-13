'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Collapsible } from 'radix-ui';
import { useState } from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import type { Labels } from '@/lib/tenant/labels';

import { NAVIGATION, navItemTitle, type NavItem } from './navigation';

type AppSidebarProps = {
  labels: Labels;
  workspaceName: string;
  permissions: string[];
  features: string[];
};

function isCurrent(pathname: string, item: NavItem) {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AppSidebar({ labels, workspaceName, permissions, features }: AppSidebarProps) {
  const pathname = usePathname();
  const { state, isMobile } = useSidebar();
  const granted = new Set(permissions);
  const groups = NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        (!item.permission || granted.has(item.permission)) &&
        (!item.feature || features.includes(item.feature)),
    ),
  })).filter((group) => group.items.length > 0);

  // What the person opened or closed by hand. A group they have not touched is open only while
  // it holds the page they are on, so moving around never leaves a pile of open groups behind.
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  // The icon rail has no room for titles, so there every page is its own icon.
  const rail = state === 'collapsed' && !isMobile;

  const link = (item: NavItem) => {
    const title = navItemTitle(item, labels);
    const Icon = item.icon;
    return (
      <SidebarMenuItem key={item.href}>
        {item.available ? (
          <SidebarMenuButton asChild tooltip={title} isActive={isCurrent(pathname, item)}>
            <Link href={item.href}>
              <Icon aria-hidden />
              <span>{title}</span>
            </Link>
          </SidebarMenuButton>
        ) : (
          <SidebarMenuButton disabled tooltip={title}>
            <Icon aria-hidden />
            <span>{title}</span>
          </SidebarMenuButton>
        )}
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex h-10 items-center gap-2 px-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
            {workspaceName.charAt(0)}
          </span>
          <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">
            {workspaceName}
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Workspace">
          <SidebarGroup>
            <SidebarMenu>
              {groups.map((group) => {
                if (group.pinned || rail) return group.items.map(link);

                const holdsCurrent = group.items.some((item) => isCurrent(pathname, item));
                const open = chosen[group.title] ?? holdsCurrent;
                const GroupIcon = group.icon;
                return (
                  <Collapsible.Root
                    key={group.title}
                    asChild
                    open={open}
                    onOpenChange={(next) =>
                      setChosen((current) => ({ ...current, [group.title]: next }))
                    }
                  >
                    <SidebarMenuItem>
                      <Collapsible.Trigger asChild>
                        <SidebarMenuButton
                          className={holdsCurrent && !open ? 'font-medium text-primary' : undefined}
                        >
                          <GroupIcon aria-hidden />
                          <span className="flex-1">{group.title}</span>
                          <ChevronDown
                            aria-hidden
                            className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                          />
                        </SidebarMenuButton>
                      </Collapsible.Trigger>
                      <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                        <SidebarMenuSub>
                          {group.items.map((item) => {
                            const title = navItemTitle(item, labels);
                            const Icon = item.icon;
                            return (
                              <SidebarMenuSubItem key={item.href}>
                                {item.available ? (
                                  <SidebarMenuSubButton
                                    asChild
                                    isActive={isCurrent(pathname, item)}
                                  >
                                    <Link href={item.href}>
                                      <Icon aria-hidden />
                                      <span>{title}</span>
                                    </Link>
                                  </SidebarMenuSubButton>
                                ) : (
                                  <SidebarMenuSubButton aria-disabled>
                                    <Icon aria-hidden />
                                    <span>{title}</span>
                                  </SidebarMenuSubButton>
                                )}
                              </SidebarMenuSubItem>
                            );
                          })}
                        </SidebarMenuSub>
                      </Collapsible.Content>
                    </SidebarMenuItem>
                  </Collapsible.Root>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
