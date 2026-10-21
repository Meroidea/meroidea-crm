import type { MetadataRoute } from 'next';

/**
 * The public site may be indexed; the platform console, API and one-time links may not. Signed-in
 * pages already need a session, so they never show search engines anything either way.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/platform', '/api/', '/auth/', '/agreement/', '/offer/', '/set-password'],
    },
  };
}
