/** Workspace addresses: {slug}.meroidea.app — see docs/onboarding.md §2. */
export const RESERVED_SLUGS = new Set([
  'app',
  'www',
  'admin',
  'api',
  'help',
  'status',
  'mail',
  'billing',
  'support',
  'docs',
  'blog',
  'meroidea',
  'login',
  'signup',
  'dashboard',
  'settings',
  'static',
  'assets',
]);

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug) && !RESERVED_SLUGS.has(slug);
}

/**
 * First free slug for a company name. `taken` reports whether a candidate already exists;
 * collisions get a numeric suffix rather than failing the sign-up.
 */
export async function uniqueSlug(
  companyName: string,
  taken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const base = slugify(companyName) || 'workspace';
  const seed = base.length < 3 ? `${base}-workspace` : base;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? seed : `${seed}-${attempt + 1}`;
    if (isValidSlug(candidate) && !(await taken(candidate))) return candidate;
  }
  return `${seed}-${Date.now().toString(36)}`;
}
