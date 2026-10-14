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
        description="Records who and where the business is, creates its workspace, and sends its admin the service agreement. Once they accept, they choose their password, add staff and set things up their own way."
      />
      <NewBusinessForm />
    </div>
  );
}
