import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { formatDate } from '@/lib/format';
import { Markdown } from '@/modules/kb/components/markdown';
import { ArticleFeedback, ArticleViewBeacon } from '@/modules/kb/components/portal-tools';
import { getPublicArticle, getPublicPortal } from '@/modules/kb/public';
import { serverEnv } from '@/server/env';

export async function generateMetadata({
  params,
}: PageProps<'/help/[slug]/[article]'>): Promise<Metadata> {
  const { slug, article: articleSlug } = await params;
  const portal = await getPublicPortal(slug);
  const article = portal ? await getPublicArticle(portal, articleSlug) : null;
  if (!portal || !article) return { title: 'Not found', robots: { index: false } };
  const canonical = `${serverEnv().APP_URL}/help/${portal.slug}/${article.slug}`;
  return {
    title: `${article.title} · ${portal.title}`,
    description: article.summary ?? undefined,
    alternates: { canonical },
    openGraph: {
      type: 'article',
      title: article.title,
      description: article.summary ?? undefined,
      url: canonical,
    },
    // A link sent to a customer carries a token until the page takes it out: never send it on.
    referrer: 'no-referrer',
  };
}

/** One published article on the portal (ADR-071). */
export default async function PortalArticle({ params }: PageProps<'/help/[slug]/[article]'>) {
  const { slug, article: articleSlug } = await params;
  const portal = await getPublicPortal(slug);
  const article = portal ? await getPublicArticle(portal, articleSlug) : null;
  if (!portal || !article) notFound();
  return (
    <article className="flex flex-col gap-6">
      <ArticleViewBeacon slug={portal.slug} article={article.slug} />
      <Link
        href={`/help/${portal.slug}`}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> {portal.title}
      </Link>
      <header className="flex flex-col gap-2">
        {article.categoryName && (
          <p className="text-sm font-medium text-primary">{article.categoryName}</p>
        )}
        <h1 className="text-3xl font-semibold tracking-tight text-balance">{article.title}</h1>
        {article.summary && <p className="text-lg text-muted-foreground">{article.summary}</p>}
        <p className="text-xs text-muted-foreground">
          Updated {formatDate({ tenant: { timezone: portal.timezone } }, article.updatedAt)}
        </p>
      </header>
      <Markdown>{article.bodyMarkdown}</Markdown>
      <footer className="rounded-xl border bg-card p-4">
        <ArticleFeedback slug={portal.slug} article={article.slug} />
      </footer>
    </article>
  );
}
