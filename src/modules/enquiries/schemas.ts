import { z } from 'zod';

export const TEAM_SIZES = ['Just me', '2–10', '11–50', '51–200', 'More than 200'] as const;
export const ENQUIRY_STATUSES = ['new', 'contacted', 'closed'] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer`)
    .transform((value) => (value === '' ? null : value));

/** The website's "Let's talk" form. `website` is a honeypot: people never see or fill it. */
export const submitEnquirySchema = z.object({
  name: z.string().trim().min(1, 'Tell us your name').max(120, 'Use 120 characters or fewer'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, 'That email address is too long')
    .pipe(z.email('Enter a valid email address')),
  phone: optionalText(32).refine((value) => value === null || /^[+()\d\s-]+$/.test(value), {
    message: 'Use digits, spaces, +, - and brackets only',
  }),
  company: z
    .string()
    .trim()
    .min(1, 'Tell us your business name')
    .max(160, 'Use 160 characters or fewer'),
  businessType: optionalText(120),
  teamSize: z
    .union([z.enum(TEAM_SIZES), z.literal('')])
    .transform((value) => (value === '' ? null : value)),
  message: z
    .string()
    .trim()
    .min(10, 'Tell us a little more, at least 10 characters')
    .max(4000, 'Use 4,000 characters or fewer'),
  website: z.string().max(500).optional(),
});

export type SubmitEnquiryInput = z.input<typeof submitEnquirySchema>;

export const setEnquiryStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(ENQUIRY_STATUSES),
});
