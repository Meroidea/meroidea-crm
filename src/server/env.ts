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
  /**
   * Email inbox (ADR-070): the domain Resend receives mail for (an MX record points at Resend)
   * and sends replies from. Businesses' inbox addresses and per-thread reply addresses live here.
   */
  INBOX_EMAIL_DOMAIN: z
    .string()
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/)
    .optional(),
  /** The signing secret (whsec_…) of the Resend webhook that delivers received mail and events. */
  RESEND_WEBHOOK_SECRET: z
    .string()
    .regex(/^whsec_[A-Za-z0-9+/=]{16,}$/)
    .optional(),
  /** Fair Work Commission Modern Awards Pay Database. Without it, minimums are entered by hand. */
  FWC_API_KEY: z.string().min(1).optional(),
  /** 32 random bytes, base64. Encrypts tax file, bank and super numbers at rest. */
  HR_ENCRYPTION_KEY: z.string().min(40).optional(),
  /**
   * Comma-separated keys being retired (ADR-040). They only read existing values, until the
   * platform console's re-encryption has moved everything onto HR_ENCRYPTION_KEY.
   */
  HR_ENCRYPTION_KEYS_PREVIOUS: z.string().optional(),
  /**
   * Sent by the scheduler (Vercel Cron, as `Authorization: Bearer …`) to run the daily lead
   * alerts. Without it the scheduled route refuses every call; alerts still run in the app.
   */
  CRON_SECRET: z.string().min(32).optional(),
  /**
   * Social inbox (ADR-064): the platform owner's Meta app. Without the id, secret and login
   * configuration, businesses cannot connect Facebook or Instagram; without the verify token,
   * Meta cannot confirm the webhook address.
   */
  META_APP_ID: z.string().min(1).optional(),
  META_APP_SECRET: z.string().min(16).optional(),
  /** The Facebook Login for Business configuration that asks for the messaging permissions. */
  META_LOGIN_CONFIG_ID: z.string().min(1).optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(16).optional(),
  /**
   * WhatsApp (ADR-066): the Embedded Signup configuration of the same Meta app. Without it,
   * businesses cannot connect a WhatsApp number.
   */
  META_WHATSAPP_CONFIG_ID: z.string().min(1).optional(),
  /** The Graph API version the client calls; change it when Meta retires this one. */
  META_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v27.0'),
  /** The platform owner's TikTok for Business developer app, once approved for messaging. */
  TIKTOK_APP_ID: z.string().min(1).optional(),
  TIKTOK_APP_SECRET: z.string().min(16).optional(),
  /** The "TikTok account holder authorization URL" shown on the developer app's page. */
  TIKTOK_AUTH_URL: z.url({ protocol: /^https$/ }).optional(),
  /**
   * AI assistant (ADR-074): a Google Gemini API key from Google AI Studio. Without it the
   * assistant says it is not set up. One key serves every business, so its quota is shared.
   */
  GEMINI_API_KEY: z.string().min(1).optional(),
  /** Model names, so a retired model can be replaced without a code change. */
  GEMINI_MODEL_REASONING: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{2,80}$/)
    .default('gemini-3.8-flash'),
  GEMINI_MODEL_FAST: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{2,80}$/)
    .default('gemini-3.5-flash-lite'),
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
