import { describe, expect, it } from 'vitest';

import nextConfig from '../../next.config';

type Rule = { source: string; headers: { key: string; value: string }[] };

// The last matching rule wins for a header key (Next.js "Header Overriding Behavior"). This walks
// the rules the way Next.js does for a few representative paths, using its path syntax only as
// far as next.config.ts does.
async function headersFor(path: string): Promise<Record<string, string>> {
  const rules = ((await nextConfig.headers?.()) ?? []) as Rule[];
  const matches = (source: string) => {
    if (source === '/:path*') return true;
    if (source === '/:path((?!f/).*)') return !path.startsWith('/f/');
    if (source === '/f/:path*') return path.startsWith('/f/');
    const area = /^\/:area\(([^)]+)\)\/:path\*$/.exec(source);
    if (area) return area[1]!.split('|').some((name) => path.startsWith(`/${name}/`));
    return source === path;
  };
  const result: Record<string, string> = {};
  for (const rule of rules.filter((candidate) => matches(candidate.source))) {
    for (const header of rule.headers) result[header.key.toLowerCase()] = header.value;
  }
  return result;
}

describe('security headers (ADR-059)', () => {
  it('keep every page out of other sites’ frames and stop content sniffing', async () => {
    for (const path of ['/', '/login', '/opportunities/x', '/platform']) {
      const headers = await headersFor(path);
      expect(headers['x-frame-options']).toBe('DENY');
      expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('let a business embed its website forms on its own site', async () => {
    const headers = await headersFor('/f/abc');
    expect(headers['x-frame-options']).toBeUndefined();
    expect(headers['content-security-policy']).toContain('frame-ancestors *');
  });

  it('never send a one-time link’s address onward', async () => {
    for (const path of ['/offer/t', '/agreement/t', '/auth/confirm', '/support/t', '/f/k']) {
      expect((await headersFor(path))['referrer-policy']).toBe('no-referrer');
    }
  });

  it('allow location for clocking in and nothing else sensitive', async () => {
    const policy = (await headersFor('/'))['permissions-policy'] ?? '';
    expect(policy).toContain('geolocation=(self)');
    expect(policy).toContain('camera=()');
    expect(policy).toContain('microphone=()');
  });
});
