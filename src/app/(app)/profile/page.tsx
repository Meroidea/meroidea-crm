import { KeyRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Avatar } from '@/components/data/avatar';
import { PageHeader } from '@/components/data/page-header';
import { Button } from '@/components/ui/button';
import { MyDetailsForm } from '@/modules/profile/components/my-details-form';
import { getMyProfile } from '@/modules/profile/queries';
import { requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'My details' };

export default async function MyDetailsPage() {
  const ctx = await requireTenantContext();
  const profile = await getMyProfile(ctx);

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="My details" description="How you appear to your colleagues." />

      <section className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-5">
        <Avatar name={profile.fullName} className="size-14 text-lg" />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{profile.fullName}</p>
          <p className="truncate text-sm text-muted-foreground">
            {profile.roleName} · {profile.businessName}
          </p>
        </div>
      </section>

      <section aria-labelledby="details-heading" className="rounded-xl border bg-card p-5">
        <h2 id="details-heading" className="mb-4 text-base font-semibold">
          Personal details
        </h2>
        <MyDetailsForm fullName={profile.fullName} email={profile.email} phone={profile.phone} />
      </section>

      <section
        aria-labelledby="security-heading"
        className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-5"
      >
        <div>
          <h2 id="security-heading" className="text-base font-semibold">
            Password
          </h2>
          <p className="text-sm text-muted-foreground">
            Choose a new one at any time. You stay signed in on this device.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/set-password">
            <KeyRound aria-hidden /> Change password
          </Link>
        </Button>
      </section>
    </div>
  );
}
