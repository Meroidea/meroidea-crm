import { z } from 'zod';

/*
 * The knowledge base's inputs (ADR-071). The same schemas check the editor's forms in the
 * browser and every write on the server.
 */

export const ARTICLE_STATUSES = ['draft', 'published'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];
export const ARTICLE_STATUS_LABELS: Record<ArticleStatus, string> = {
  draft: 'Draft',
  published: 'Published',
};

/** "How do I change my booking?" → "how-do-i-change-my-booking", at most `max` characters. */
export function articleSlug(input: string, max = 120): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

const slugField = (max: number) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .max(max, `At most ${max} characters`)
    .regex(/^([a-z0-9]([a-z0-9-]*[a-z0-9])?)?$/, 'Use lower-case letters, numbers and dashes')
    .optional()
    .transform((value) => value || undefined);

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((value) => value || null);

export const articleSchema = z.object({
  id: z.uuid().optional(),
  title: z
    .string()
    .trim()
    .min(1, 'Give it a title')
    .max(200, 'Keep the title under 200 characters'),
  /** Left empty, it is made from the title. */
  slug: slugField(120),
  categoryId: z
    .union([z.uuid(), z.literal('')])
    .nullish()
    .transform((value) => value || null),
  summary: optionalText(300, 'Keep the summary under 300 characters'),
  bodyMarkdown: z.string().max(100_000, 'That article is too long'),
  status: z.enum(ARTICLE_STATUSES),
});
/** Left out, the address is made from the title. */
export type ArticleInput = Omit<z.output<typeof articleSchema>, 'slug'> & {
  slug?: string | undefined;
};

export const categorySchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, 'Give it a name').max(80, 'Keep the name under 80 characters'),
  slug: slugField(80),
  description: optionalText(300, 'Keep the description under 300 characters'),
  position: z.number().int().min(0).max(1000).default(0),
});
export type CategoryInput = Omit<z.output<typeof categorySchema>, 'slug'> & {
  slug?: string | undefined;
};

export const portalSchema = z.object({
  isPublic: z.boolean(),
  title: optionalText(120, 'Keep the title under 120 characters'),
  intro: optionalText(500, 'Keep the introduction under 500 characters'),
});
export type PortalInput = z.output<typeof portalSchema>;

export const idSchema = z.object({ id: z.uuid() });

export const articleSearchSchema = z.object({ q: z.string().trim().max(100).default('') });

/** A link to an article for a reply: in an inbox conversation, or on a ticket. */
export const articleLinkSchema = z
  .object({
    articleId: z.uuid(),
    conversationId: z.uuid().optional(),
    ticketId: z.uuid().optional(),
  })
  .refine((value) => Boolean(value.conversationId) !== Boolean(value.ticketId), {
    message: 'Choose where the link is going',
  });
export type ArticleLinkInput = z.output<typeof articleLinkSchema>;

/** What the portal's "Was this helpful?" sends. */
export const feedbackSchema = z.object({
  article: z.string().max(120),
  helpful: z.boolean(),
  comment: z
    .string()
    .trim()
    .max(1000, 'Keep it under 1,000 characters')
    .optional()
    .transform((value) => value || null),
});

/** What the portal's article page reports once it has been shown in a browser. */
export const viewSchema = z.object({
  article: z.string().max(120),
  /** The token of a link sent to a known customer, when the page was opened from one. */
  ref: z
    .string()
    .regex(/^[A-Za-z0-9_-]{20,64}$/)
    .optional(),
});
