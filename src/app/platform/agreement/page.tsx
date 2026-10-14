import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/data/page-header';
import { ContractBody } from '@/modules/hiring/components/contract-body';
import { PublishAgreementForm } from '@/modules/platform/components/agreement-tools';
import { listAgreements } from '@/modules/platform/service';
import { requirePlatformAdmin } from '@/server/platform';

export const metadata: Metadata = { title: 'Service agreement' };

const published = (value: Date) =>
  new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    value,
  );

export default async function AgreementPage() {
  const admin = await requirePlatformAdmin();
  const versions = await listAgreements(admin);
  const [current, ...older] = versions;

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/platform" className="underline-offset-4 hover:underline">
          Businesses
        </Link>{' '}
        / Service agreement
      </nav>
      <PageHeader
        title="Service agreement"
        description="What every business's admin accepts before their workspace opens. Each version is kept unchanged, so every acceptance points at the exact words that were accepted."
      />

      {current ? (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-medium">
            Current: {current.title} · version {current.version}
          </h2>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            Published {published(current.publishedAt)} · accepted by {current.accepted}{' '}
            {current.accepted === 1 ? 'business' : 'businesses'}
          </p>
          <details>
            <summary className="cursor-pointer text-sm text-primary">Show the wording</summary>
            <div className="mt-3">
              <ContractBody body={current.body} />
            </div>
          </details>
        </section>
      ) : (
        <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
          No agreement is published yet. Publish one before onboarding a business: its admin accepts
          it before their workspace opens.
        </p>
      )}

      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-medium">
          {current ? 'Publish a new version' : 'Publish the agreement'}
        </h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Have the wording reviewed by a lawyer first. Businesses that already accepted keep the
          version they accepted; links sent from now on carry the new one.
        </p>
        <PublishAgreementForm initialTitle={current?.title ?? 'Meroidea service agreement'} />
      </section>

      {older.length > 0 && (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-medium">Earlier versions</h2>
          <ul className="mt-3 divide-y">
            {older.map((version) => (
              <li key={version.id} className="py-2 text-sm">
                {version.title} · version {version.version} · published{' '}
                {published(version.publishedAt)} · accepted by {version.accepted}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
