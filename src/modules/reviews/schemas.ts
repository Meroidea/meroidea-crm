import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const DEFAULT_PROMPT = 'How was your experience with us?';

export const saveLinkSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, 'Say where this link is used').max(80),
  prompt: z.string().trim().min(5, 'Enter the question customers see').max(160),
  isActive: z.boolean().default(true),
});

/** What a customer sends from the public page. */
export const submitReviewSchema = z.object({
  rating: z.coerce
    .number('Choose a rating')
    .int('Choose a rating')
    .min(1, 'Choose a rating')
    .max(5, 'Choose a rating from 1 to 5'),
  comment: optionalText(2000),
  customerName: optionalText(120),
  customerEmail: z
    .union([z.email('Enter a valid email address').max(200), z.literal('')])
    .nullish()
    .transform((value) => value || null),
  contactAllowed: z.boolean().default(false),
});

export const REVIEW_STATUSES = ['new', 'read', 'resolved'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  new: 'New',
  read: 'Read',
  resolved: 'Followed up',
};

export const handleReviewSchema = z.object({
  id: z.uuid(),
  status: z.enum(REVIEW_STATUSES),
  internalNote: optionalText(1000),
});
export const idSchema = z.object({ id: z.uuid() });

export const reviewParamsSchema = z.object({
  view: z.enum(['inbox', 'links']).optional().catch(undefined),
  status: z.enum(REVIEW_STATUSES).optional().catch(undefined),
  rating: z.coerce.number().int().min(1).max(5).optional().catch(undefined),
});

export type SaveLinkInput = z.output<typeof saveLinkSchema>;
export type SubmitReviewInput = z.output<typeof submitReviewSchema>;
export type HandleReviewInput = z.output<typeof handleReviewSchema>;
