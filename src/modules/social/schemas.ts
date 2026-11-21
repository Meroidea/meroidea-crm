import { z } from 'zod';

import { OAUTH_PROVIDERS } from './oauth-state-keys';
import { SOCIAL_PLATFORMS } from './providers/types';

export const INBOX_VIEWS = ['open', 'unread', 'done', 'all'] as const;

export const inboxFiltersSchema = z.object({
  view: z.enum(INBOX_VIEWS).optional().catch(undefined),
  platform: z.enum(SOCIAL_PLATFORMS).optional().catch(undefined),
  cursor: z.string().max(300).optional().catch(undefined),
});
export type InboxFilters = z.output<typeof inboxFiltersSchema>;

export const startConnectSchema = z.object({ provider: z.enum(OAUTH_PROVIDERS) });

export const accountIdSchema = z.object({ accountId: z.uuid() });

export const conversationIdSchema = z.object({ conversationId: z.uuid() });

/** The longest any provider accepts (TikTok); each platform's own limit is checked when sending. */
export const replySchema = z.object({
  conversationId: z.uuid(),
  body: z.string().trim().min(1, 'Write a reply first').max(6000, 'That reply is too long'),
});
export type ReplyInput = z.output<typeof replySchema>;

export const messageIdSchema = z.object({ messageId: z.uuid() });

export const linkContactSchema = z.object({
  conversationId: z.uuid(),
  contactId: z.uuid().nullable(),
});

export const conversationStatusSchema = z.object({
  conversationId: z.uuid(),
  status: z.enum(['open', 'done']),
});

/**
 * A value for a template placeholder. WhatsApp refuses line breaks, tabs and more than four
 * spaces in a row in a value (error 132018), so they are refused here first.
 */
const templateValue = z
  .string()
  .trim()
  .min(1, 'Fill in every value')
  .max(500, 'That value is too long')
  .refine((value) => !/[\n\r\t]/.test(value) && !/ {5,}/.test(value), {
    message: 'Values cannot have line breaks, tabs or long runs of spaces',
  });

export const templateReplySchema = z.object({
  conversationId: z.uuid(),
  templateId: z.uuid(),
  values: z.array(templateValue).max(20),
});
export type TemplateReplyInput = z.output<typeof templateReplySchema>;

/**
 * What the page reports when Embedded Signup finishes. The ids come from the browser, so the
 * service trusts them only after the business's own token finds that number in that account.
 */
export const connectWhatsAppSchema = z.object({
  code: z.string().min(1).max(2048),
  wabaId: z.string().regex(/^\d{5,30}$/),
  phoneNumberId: z.string().regex(/^\d{5,30}$/),
  coexistence: z.boolean(),
});
export type ConnectWhatsAppInput = z.output<typeof connectWhatsAppSchema>;

/** Languages offered for a new template; Meta supports more, added as businesses need them. */
export const TEMPLATE_LANGUAGES = {
  en: 'English',
  en_GB: 'English (UK)',
  en_US: 'English (US)',
  zh_CN: 'Chinese (simplified)',
  zh_HK: 'Chinese (Hong Kong)',
  zh_TW: 'Chinese (traditional)',
  vi: 'Vietnamese',
  ko: 'Korean',
  ja: 'Japanese',
  th: 'Thai',
  id: 'Indonesian',
  ms: 'Malay',
  fil: 'Filipino',
  hi: 'Hindi',
  pa: 'Punjabi',
  bn: 'Bengali',
  ur: 'Urdu',
  ta: 'Tamil',
  ar: 'Arabic',
  es: 'Spanish',
  it: 'Italian',
  el: 'Greek',
  de: 'German',
  fr: 'French',
  pt_BR: 'Portuguese (Brazil)',
} as const;

const noPlaceholder = (value: string | undefined) => !value || !value.includes('{{');

/**
 * A new WhatsApp template for Meta's review. Placeholders are numbered {{1}}, {{2}}… in order,
 * each with an example (Meta reviews with them), and the body may not start or end with one
 * (Meta refuses those).
 */
export const createTemplateSchema = z
  .object({
    accountId: z.uuid(),
    name: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{1,100}$/, 'Use lower-case letters, numbers and underscores only'),
    category: z.enum(['utility', 'marketing']),
    language: z.enum(Object.keys(TEMPLATE_LANGUAGES) as [keyof typeof TEMPLATE_LANGUAGES]),
    body: z.string().trim().min(1, 'Write the message').max(1024, 'At most 1024 characters'),
    examples: z.array(z.string().trim().min(1, 'Give an example').max(200)).max(20),
    headerText: z
      .string()
      .trim()
      .max(60, 'At most 60 characters')
      .refine(noPlaceholder, 'The heading cannot have placeholders')
      .optional()
      .transform((value) => value || null),
    footerText: z
      .string()
      .trim()
      .max(60, 'At most 60 characters')
      .refine(noPlaceholder, 'The footer cannot have placeholders')
      .optional()
      .transform((value) => value || null),
  })
  .superRefine((input, issues) => {
    const found = [...input.body.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((match) => match[1]);
    const distinct = [...new Set(found)];
    const expected = distinct.map((_, index) => String(index + 1));
    if (distinct.some((name, index) => name !== expected[index])) {
      issues.addIssue({
        code: 'custom',
        path: ['body'],
        message: 'Number the placeholders {{1}}, {{2}}… in the order they appear',
      });
      return;
    }
    if (/^\s*\{\{/.test(input.body) || /\}\}\s*$/.test(input.body)) {
      issues.addIssue({
        code: 'custom',
        path: ['body'],
        message: 'The message cannot start or end with a placeholder',
      });
    }
    if (input.examples.length !== distinct.length) {
      issues.addIssue({
        code: 'custom',
        path: ['examples'],
        message: 'Give one example for each placeholder',
      });
    }
  });
export type CreateTemplateInput = z.output<typeof createTemplateSchema>;

export const templateIdSchema = z.object({ templateId: z.uuid() });
