/*
 * Shared plumbing for the one-off demo scripts. They run outside Next.js with the production
 * environment in process.env, so everything here reads only process.env and never prints a
 * secret, a link or a token.
 */

import { platformOwnerEmails, type PlatformAdmin } from '@/server/platform';
import { createSupabaseAdminClient } from '@/server/supabase/admin';

/** `--name value` and `--flag` arguments. */
export function parseArgs(argv: string[]): Map<string, string | true> {
  const args = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith('--')) continue;
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (!name) continue;
    const next = argv[index + 1];
    if (inline !== undefined) args.set(name, inline);
    else if (next !== undefined && !next.startsWith('--')) {
      args.set(name, next);
      index += 1;
    } else args.set(name, true);
  }
  return args;
}

/** Comma-separated names, trimmed, empties dropped. */
export const splitNames = (value: string | true | undefined): string[] =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    : [];

/** Every auth user, page by page (the admin API caps a page at 1000). */
export async function listAuthUsers(): Promise<
  { id: string; email: string | null; confirmed: boolean }[]
> {
  const supabase = createSupabaseAdminClient();
  const users: { id: string; email: string | null; confirmed: boolean }[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not list logins: ${error.message}`);
    for (const user of data.users) {
      users.push({
        id: user.id,
        email: user.email?.toLowerCase() ?? null,
        confirmed: Boolean(user.email_confirmed_at),
      });
    }
    if (data.users.length < 1000) return users;
  }
}

/**
 * The platform owner the scripts act as, built exactly as getPlatformAdmin() builds it: a
 * confirmed auth user whose email is in PLATFORM_ADMIN_EMAILS. `preferred` picks one when the
 * list has several.
 */
export async function findPlatformAdmin(preferred?: string): Promise<PlatformAdmin> {
  const owners = platformOwnerEmails();
  if (owners.length === 0) {
    throw new Error('PLATFORM_ADMIN_EMAILS is empty. Set it to the platform owner’s email.');
  }
  const wanted = preferred ? [preferred.trim().toLowerCase()] : owners;
  if (preferred && !owners.includes(wanted[0] ?? '')) {
    throw new Error('--as must be one of the emails in PLATFORM_ADMIN_EMAILS.');
  }
  const users = await listAuthUsers();
  for (const email of wanted) {
    const user = users.find((candidate) => candidate.email === email && candidate.confirmed);
    if (user) return { userId: user.id, email };
  }
  throw new Error(
    'No confirmed login exists for the platform owner’s email. Sign in to /platform once first.',
  );
}

/** The next Monday after `today` in Sydney, as YYYY-MM-DD. */
export function nextMonday(today: Date = new Date()): string {
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(today);
  const date = new Date(`${local}T00:00:00Z`);
  const ahead = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + ahead);
  return date.toISOString().slice(0, 10);
}

/** Runs a script's main, prints a failure without its stack's data, and ends the process. */
export function runMain(main: () => Promise<number | void>): void {
  main()
    .then((code) => process.exit(code ?? 0))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\nFailed: ${message}`);
      process.exit(1);
    });
}

/** True when this file is the one `tsx` was asked to run, rather than imported by a test. */
export const isEntry = (fileName: string): boolean =>
  (process.argv[1] ?? '').replace(/\\/g, '/').endsWith(`scripts/demo/${fileName}`);
