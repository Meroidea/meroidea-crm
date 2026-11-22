import { getPublicPortal, listSitemapArticles } from '@/modules/kb/public';
import { serverEnv } from '@/server/env';

const escapeXml = (value: string) =>
  value.replace(/[<>&'"]/g, (char) => `&#${char.charCodeAt(0)};`);

/** The portal's sitemap for search engines: its home and every published article (ADR-071). */
export async function GET(_request: Request, { params }: RouteContext<'/help/[slug]/sitemap.xml'>) {
  const portal = await getPublicPortal((await params).slug);
  if (!portal) return new Response('Not found', { status: 404 });
  const base = `${serverEnv().APP_URL}/help/${portal.slug}`;
  const articles = await listSitemapArticles(portal);
  const urls = [
    `<url><loc>${escapeXml(base)}</loc></url>`,
    ...articles.map(
      (article) =>
        `<url><loc>${escapeXml(`${base}/${article.slug}`)}</loc><lastmod>${article.updatedAt.toISOString()}</lastmod></url>`,
    ),
  ];
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`,
    { headers: { 'content-type': 'application/xml; charset=utf-8' } },
  );
}
