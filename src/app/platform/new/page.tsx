import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/data/page-header';
import { NewBusinessForm } from '@/modules/platform/components/platform-tools';
import { requirePlatformAdmin } from '@/server/platform';

export const metadata: Metadata = { title: 'Onboard a business' };

export default async function NewBusinessPage() {
  await requirePlatformAdmin();
  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/platform" className="underline-offset-4 hover:underline">
          Businesses
        </Link>{' '}
        / Onboard
      </nav>
      <PageHeader
        title="Onboard a business"
        description="Creates their workspace and their admin’s login. Their admin then adds staff and sets things up their own way."
      />
      <NewBusinessForm />
    </div>
  );
}
