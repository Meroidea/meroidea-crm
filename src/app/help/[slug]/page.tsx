import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getPublicPortal, listPublicArticles } from '@/modules/kb/public';
import { serverEnv } from '@/server/env';

export async function generateMetadata({ params }: PageProps<'/help/[slug]'>): Promise<Metadata> {
  const portal = await getPublicPortal((await params).slug);
  if (!portal) return { title: 'Not found', robots: { index: false } };
  return {
    title: portal.title,
    description: portal.intro ?? `Answers to common questions from ${portal.businessName}.`,
    alternates: { canonical: `${serverEnv().APP_URL}/help/${portal.slug}` },
  };
}

/** The portal's home: search, and every published article under its category. */
export default async function PortalHome({ params, searchParams }: PageProps<'/help/[slug]'>) {
  const portal = await getPublicPortal((await params).slug);
  if (!portal) notFound();
  const raw = (await searchParams).q;
  const q = typeof raw === 'string' ? raw.trim().slice(0, 100) : '';
  const { articles, categories } = await listPublicArticles(portal, q || undefined);
  const groups = [
    ...categories.map((category) => ({
      key: category.id,
      name: category.name,
      description: category.description,
      items: articles.filter((article) => article.categoryId === category.id),
    })),
    {
      key: 'other',
      name: categories.length > 0 ? 'Other articles' : 'Articles',
      description: null,
      items: articles.filter(
        (article) => !categories.some((category) => category.id === article.categoryId),
      ),
    },
  ].filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">How can we help?</h1>
        {portal.intro && <p className="text-muted-foreground">{portal.intro}</p>}
        <form action={`/help/${portal.slug}`} role="search">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search the help centre"
            aria-label="Search the help centre"
            className="h-11 w-full rounded-lg border bg-card px-4 text-base"
          />
        </form>
      </section>

      {q ? (
        <section aria-label="Search results" className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">
            {articles.length === 0
              ? `Nothing found for “${q}”`
              : `${articles.length} ${articles.length === 1 ? 'article' : 'articles'} for “${q}”`}
          </h2>
          <ArticleList slug={portal.slug} items={articles} />
          <Link
            href={`/help/${portal.slug}`}
            className="w-fit text-sm text-primary underline-offset-4 hover:underline"
          >
            All articles
          </Link>
        </section>
      ) : groups.length === 0 ? (
        <p className="text-muted-foreground">There are no articles here yet.</p>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="flex flex-col gap-3">
            <div>
              <h2 className="text-lg font-semibold">{group.name}</h2>
              {group.description && (
                <p className="text-sm text-muted-foreground">{group.description}</p>
              )}
            </div>
            <ArticleList slug={portal.slug} items={group.items} />
          </section>
        ))
      )}
    </div>
  );
}

function ArticleList({
  slug,
  items,
}: {
  slug: string;
  items: { title: string; slug: string; summary: string | null }[];
}) {
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {items.map((article) => (
        <li key={article.slug}>
          <Link
            href={`/help/${slug}/${article.slug}`}
            className="block px-4 py-3 hover:bg-muted/50"
          >
            <p className="font-medium">{article.title}</p>
            {article.summary && (
              <p className="line-clamp-2 text-sm text-muted-foreground">{article.summary}</p>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
