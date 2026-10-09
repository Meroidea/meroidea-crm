import 'server-only';

import { z } from 'zod';

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  SUPABASE_SECRET_KEY: z.string().min(1),
  APP_URL: z.url().default('http://localhost:3000'),
  /** Comma-separated emails of the platform owners who may open /platform (ADR-029). */
  PLATFORM_ADMIN_EMAILS: z.string().optional(),
  /**
   * OnlyOffice Document Server (ADR-030). ONLYOFFICE_URL is where people's browsers load the
   * editor from; the secret signs everything exchanged with it. Without both, documents can be
   * stored and downloaded but not edited in the browser.
   */
  ONLYOFFICE_URL: z.url().optional(),
  ONLYOFFICE_JWT_SECRET: z.string().min(32).optional(),
  /** How the document server reaches this app, when that differs from APP_URL (Docker). */
  APP_INTERNAL_URL: z.url().optional(),
  /** How this app reaches the document server, when that differs from ONLYOFFICE_URL. */
  ONLYOFFICE_INTERNAL_URL: z.url().optional(),
  /** Transactional email (ADR-023). Without these, contract links are shown to copy instead. */
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).optional(),
  /** Fair Work Commission Modern Awards Pay Database. Without it, minimums are entered by hand. */
  FWC_API_KEY: z.string().min(1).optional(),
  /** 32 random bytes, base64. Encrypts tax file, bank and super numbers at rest. */
  HR_ENCRYPTION_KEY: z.string().min(40).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/** Parsed lazily so `next build` doesn't need database credentials. */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Names only — never echo values, they are secrets.
    const invalid = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid server environment: ${invalid.join(', ')}. See .env.example.`);
  }
  cached = parsed.data;
  return cached;
}
