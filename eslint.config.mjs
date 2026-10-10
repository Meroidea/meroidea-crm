import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Tenant isolation: the raw and admin clients connect as `postgres` and bypass RLS.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/server/db/client',
                '@/server/db/admin',
                '**/server/db/client',
                '**/server/db/admin',
              ],
              message:
                'Raw/admin DB clients bypass RLS. Use withRls(ctx, …) — see docs/architecture.md. adminDb is only for migrations, seeds, cron and verified webhooks.',
            },
          ],
        },
      ],
    },
  },
  {
    // provision.ts writes the first tenant, before any membership exists for RLS to match.
    // settings/workspace.ts updates the caller's own `tenants` row, which users may only read.
    files: [
      'src/server/db/**/*.ts',
      'src/db/seed.ts',
      'src/modules/tenants/provision.ts',
      'src/modules/settings/workspace.ts',
      // The new hire's one-time link: no session exists, the link's secret is the credential.
      'src/modules/hiring/public.ts',
      // A job's public apply page: no session, the job's unguessable address is the credential.
      'src/modules/recruitment/public.ts',
      // Public review and support pages: no session, the page's unguessable address is the credential.
      'src/modules/reviews/public.ts',
      'src/modules/helpdesk/public.ts',
      // The platform owner's console works across every business by design (ADR-029).
      'src/modules/platform/service.ts',
      // Saves coming back from the document editing server: a verified webhook, no session.
      'src/modules/files/editor-save.ts',
      // Re-sealing payroll details onto a new key, across businesses, for platform owners (ADR-040).
      'src/modules/hiring/key-rotation.ts',
      // Per-sender counters for the public forms; no tenant data, no session (ADR-039).
      'src/server/rate-limit.ts',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'drizzle/**',
    'playwright-report/**',
    'test-results/**',
  ]),
]);

export default eslintConfig;
