import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/data/page-header';
import { getSignature } from '@/modules/social/compose-service';
import { SignatureForm } from '@/modules/social/components/signature-form';
import { requirePermission, requireTenantContext } from '@/server/context';

import { areaSwitchedOn, loadInboxArea } from '../../social/inbox-area';

export const metadata: Metadata = { title: 'My email signature' };

/** The person's own email signature (ADR-091). */
export default async function SignaturePage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'social.reply');
  if (!areaSwitchedOn(ctx.tenant.features, 'email')) notFound();
  const [area, signature] = await Promise.all([loadInboxArea(ctx, 'email'), getSignature(ctx)]);
  const inbox = area.newEmailFrom[0];
  return (
    <div className="flex w-full max-w-3xl flex-col gap-4">
      <PageHeader
        title="My email signature"
        description="Added below what you write in new emails, replies and forwards."
      />
      {inbox ? (
        <SignatureForm accountId={inbox.id} signature={signature} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Your business needs an email inbox address before signatures can be used.
        </p>
      )}
    </div>
  );
}
