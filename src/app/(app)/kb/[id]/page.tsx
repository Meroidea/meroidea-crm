import { ArrowLeft, ThumbsDown } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { PageHeader } from '@/components/data/page-header';
import { formatDateTime } from '@/lib/format';
import { ArticleEditor } from '@/modules/kb/components/article-editor';
import { getArticle, listCategories, portalUrl } from '@/modules/kb/queries';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Article' };

export default async function ArticlePage({ params }: PageProps<'/kb/[id]'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'kb.manage');
  const parsed = z.object({ id: z.uuid() }).safeParse(await params);
  const [article, categories] = await Promise.all([
    parsed.success ? getArticle(ctx, parsed.data.id) : null,
    listCategories(ctx),
  ]);
  if (!article) notFound();
  const votes = article.helpfulCount + article.notHelpfulCount;
  return (
    <div className="flex w-full max-w-6xl flex-col gap-5">
      <Link
        href="/kb"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> Knowledge base
      </Link>
      <PageHeader
        title={article.title}
        description={`${article.viewCount} ${article.viewCount === 1 ? 'read' : 'reads'} on the portal${
          votes > 0 ? ` · ${article.helpfulCount} of ${votes} found it helpful` : ''
        }`}
      />
      <ArticleEditor
        key={article.updatedAt.toISOString()}
        article={{
          id: article.id,
          title: article.title,
          slug: article.slug,
          categoryId: article.categoryId,
          summary: article.summary,
          bodyMarkdown: article.bodyMarkdown,
          status: article.status,
        }}
        categories={categories.map(({ id, name }) => ({ id, name }))}
        portalBase={portalUrl(ctx.tenant.slug)}
      />
      {article.feedback.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border bg-card p-4">
          <h2 className="font-medium">What readers said</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {article.feedback.map((item, index) => (
              <li key={index} className="flex gap-2">
                <ThumbsDown aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="whitespace-pre-wrap">{item.comment}</span>{' '}
                  <span className="text-xs text-muted-foreground">
                    · {formatDateTime(ctx, item.createdAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
