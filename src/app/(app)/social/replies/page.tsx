import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/data/page-header';
import { CannedResponses } from '@/modules/social/components/canned-responses';
import { listCannedResponses } from '@/modules/social/queries';
import { hasPermission, requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Saved replies' };

/**
 * Saved replies (ADR-068): words put into the reply box with "/" instead of being typed again.
 * Everyone who can reply keeps their own; people with social.canned_manage write the shared ones.
 */
export default async function SavedRepliesPage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'social.reply');
  const replies = await listCannedResponses(ctx);
  return (
    <div className="flex w-full max-w-4xl flex-col gap-5">
      <Link
        href="/social"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> Social inbox
      </Link>
      <PageHeader
        title="Saved replies"
        description="Answers you give often. In a conversation, type / and a few letters of the shortcut or title to put one in the reply box, then change it as you need before sending."
      />
      <CannedResponses
        replies={replies}
        canManageShared={hasPermission(ctx, 'social.canned_manage')}
      />
    </div>
  );
}
