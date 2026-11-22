import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/data/page-header';
import { ArticleEditor } from '@/modules/kb/components/article-editor';
import { listCategories, portalUrl } from '@/modules/kb/queries';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'New article' };

export default async function NewArticlePage() {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'kb.manage');
  const categories = await listCategories(ctx);
  return (
    <div className="flex w-full max-w-6xl flex-col gap-5">
      <Link
        href="/kb"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> Knowledge base
      </Link>
      <PageHeader title="New article" />
      <ArticleEditor
        article={null}
        categories={categories.map(({ id, name }) => ({ id, name }))}
        portalBase={portalUrl(ctx.tenant.slug)}
      />
    </div>
  );
}
