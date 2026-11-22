import { BookOpen, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatRelative } from '@/lib/format';
import { CategoryManager, PortalSettings } from '@/modules/kb/components/kb-tools';
import { getPortalSettings, listArticles, listCategories } from '@/modules/kb/queries';
import { ARTICLE_STATUS_LABELS, articleSearchSchema } from '@/modules/kb/schemas';
import { requirePermission, requireTenantContext } from '@/server/context';

export const metadata: Metadata = { title: 'Knowledge base' };

/** The knowledge base's editor (ADR-071): articles, categories and the public portal. */
export default async function KnowledgeBasePage({ searchParams }: PageProps<'/kb'>) {
  const ctx = await requireTenantContext();
  requirePermission(ctx, 'kb.manage');
  const { q } = articleSearchSchema.parse({ q: (await searchParams).q ?? '' });
  const [articles, categories, portal] = await Promise.all([
    listArticles(ctx, { q: q || undefined }),
    listCategories(ctx),
    getPortalSettings(ctx),
  ]);
  return (
    <div className="flex w-full max-w-6xl flex-col gap-5">
      <PageHeader
        title="Knowledge base"
        description="Help articles customers can read on your public portal, and your team can send from replies."
        actions={
          <Button asChild>
            <Link href="/kb/new">
              <Plus aria-hidden /> New article
            </Link>
          </Button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <section className="flex min-w-0 flex-col gap-3">
          <form action="/kb">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search articles"
              aria-label="Search articles"
              className="h-9 w-full max-w-sm rounded-md border bg-background px-3 text-sm"
            />
          </form>
          {articles.length === 0 ? (
            <div className="rounded-xl border bg-card">
              <EmptyState
                icon={BookOpen}
                title={q ? 'No article matches that search' : 'No articles yet'}
                description="Write answers to the questions customers ask most."
              />
            </div>
          ) : (
            <ul className="divide-y rounded-xl border bg-card">
              {articles.map((article) => {
                const votes = article.helpfulCount + article.notHelpfulCount;
                return (
                  <li key={article.id}>
                    <Link
                      href={`/kb/${article.id}`}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/50"
                    >
                      <div className="min-w-0 flex-1 basis-60">
                        <p className="truncate font-medium">{article.title}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          {article.categoryName ?? 'No category'} · changed{' '}
                          {formatRelative(article.updatedAt)}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {article.viewCount} {article.viewCount === 1 ? 'read' : 'reads'}
                        {votes > 0 &&
                          ` · ${Math.round((article.helpfulCount / votes) * 100)}% found it helpful`}
                      </span>
                      <Badge variant={article.status === 'published' ? 'secondary' : 'outline'}>
                        {ARTICLE_STATUS_LABELS[article.status]}
                      </Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <aside className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Help portal</CardTitle>
            </CardHeader>
            <CardContent>
              <PortalSettings settings={portal} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Categories</CardTitle>
            </CardHeader>
            <CardContent>
              <CategoryManager categories={categories} />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
