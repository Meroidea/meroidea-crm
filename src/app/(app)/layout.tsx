import Link from 'next/link';
import type { ReactNode } from 'react';

import { AppSidebar } from '@/components/layout/app-sidebar';
import { PrivacyBlurToggle } from '@/components/layout/privacy-blur-toggle';
import { UserMenu } from '@/components/layout/user-menu';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SupportBanner } from '@/modules/platform/components/platform-tools';
import { requireTenantContext } from '@/server/context';
import { getPlatformAdmin } from '@/server/platform';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireTenantContext();
  const platformAdmin = await getPlatformAdmin();

  return (
    <TooltipProvider delayDuration={0}>
      <SidebarProvider>
        <AppSidebar
          labels={ctx.tenant.labels}
          workspaceName={ctx.tenant.name}
          permissions={[...ctx.grants.keys()]}
          features={ctx.tenant.features}
        />
        <SidebarInset className="min-w-0">
          {ctx.isSupport && (
            <SupportBanner tenantId={ctx.tenantId} businessName={ctx.tenant.name} />
          )}
          <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
            <SidebarTrigger className="-ml-1" />
            <div className="ml-auto flex items-center gap-1">
              {platformAdmin && !ctx.isSupport && (
                <Link
                  href="/platform"
                  className="mr-2 text-sm text-primary underline-offset-4 hover:underline"
                >
                  Platform
                </Link>
              )}
              <PrivacyBlurToggle />
              <UserMenu email={ctx.email} roleName={ctx.roleName} />
            </div>
          </header>
          <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
