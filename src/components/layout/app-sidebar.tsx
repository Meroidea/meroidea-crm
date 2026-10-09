'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import type { Labels } from '@/lib/tenant/labels';

import { NAVIGATION, navItemTitle } from './navigation';

type AppSidebarProps = {
  labels: Labels;
  workspaceName: string;
  permissions: string[];
  features: string[];
};

export function AppSidebar({ labels, workspaceName, permissions, features }: AppSidebarProps) {
  const pathname = usePathname();
  const granted = new Set(permissions);
  const groups = NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        (!item.permission || granted.has(item.permission)) &&
        (!item.feature || features.includes(item.feature)),
    ),
  })).filter((group) => group.items.length > 0);

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
          {groups.map((group) => (
            <SidebarGroup key={group.title}>
              <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const title = navItemTitle(item, labels);
                    const Icon = item.icon;
                    const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                    return (
                      <SidebarMenuItem key={item.href}>
                        {item.available ? (
                          <SidebarMenuButton asChild tooltip={title} isActive={isActive}>
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
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
